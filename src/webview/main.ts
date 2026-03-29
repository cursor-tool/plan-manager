/**
 * Webview client for Plan Manager.
 *
 * Runs inside the VS Code webview (browser context).
 * Bundled with esbuild (format: iife, platform: browser).
 * No node or VS Code API imports — only browser APIs + acquireVsCodeApi().
 */

// ---------------------------------------------------------------------------
// Types (mirrored from src/types/messages.ts for self-containment at build)
// ---------------------------------------------------------------------------

interface SerializedPlanFile {
  filePath: string
  fileName: string
  source: 'claude' | 'cursor'
  name: string
  description: string
  modifiedAt: string
  size: number
  searchableBody: string
  todoProgress: { done: number; total: number } | null
}

interface PersistedWebviewState {
  collapsedGroups: string[]
  scrollTop: number
  focusedPlanId: string | null
  searchQuery: string
  splitRatio?: number
  paneScrollTops?: { claude: number; cursor: number }
}

type HostToWebviewMessage =
  | { type: 'plansLoaded'; plans: SerializedPlanFile[] }
  | { type: 'focusSearch' }
  | { type: 'clearSearch' }
  | { type: 'configChanged'; sortBy: string }
  | ({ type: 'restoreState' } & PersistedWebviewState)
  | { type: 'commandError'; command: string; planId: string; message: string }

type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'command'; command: string; planId: string }
  | { type: 'searchStateChanged'; isActive: boolean }
  | { type: 'requestRefresh' }
  | ({ type: 'stateChanged' } & PersistedWebviewState)
  | { type: 'error'; message: string; context?: string }

// VS Code webview API type
interface VsCodeApi {
  postMessage(msg: WebviewToHostMessage): void
  setState(state: PersistedWebviewState): void
  getState(): PersistedWebviewState | undefined
}

declare function acquireVsCodeApi(): VsCodeApi

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

type Locale = 'ja' | 'en'

const translations = {
  en: {
    // Search menu
    searchReset: 'Reset Search',
    refresh: 'Refresh',
    collapseAll: 'Collapse All',
    expandAll: 'Expand All',
    closeClaude: 'Close CLAUDE CODE PLAN',
    openClaude: 'Open CLAUDE CODE PLAN',
    closeCursor: 'Close CURSOR PLAN',
    openCursor: 'Open CURSOR PLAN',
    // Card action tooltips
    convert: 'Convert',
    editor: 'Editor',
    cursor: 'Cursor',
    agent: 'Agent',
    claude: 'Claude',
    copy: 'Copy',
    reveal: 'Reveal',
  },
  ja: {
    searchReset: '検索リセット',
    refresh: '更新',
    collapseAll: '全て閉じる',
    expandAll: '全て開く',
    closeClaude: 'CLAUDE CODE PLANを閉じる',
    openClaude: 'CLAUDE CODE PLANを開く',
    closeCursor: 'CURSOR PLANを閉じる',
    openCursor: 'CURSOR PLANを開く',
    convert: '変換',
    editor: 'エディタ',
    cursor: 'Cursor',
    agent: 'エージェント',
    claude: 'Claude',
    copy: 'コピー',
    reveal: 'フォルダ表示',
  },
} as const

type TranslationKey = keyof typeof translations.en

const currentLocale: Locale = document.body.dataset.locale === 'ja' ? 'ja' : 'en'

function t(key: TranslationKey): string {
  return translations[currentLocale][key]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Format ISO date string to MM-DD HH:mm */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as unknown as T
}

// ---------------------------------------------------------------------------
// Global tooltip manager — ensures only one card tooltip is visible at a time
// ---------------------------------------------------------------------------

let activeTooltip: { tip: HTMLElement; timer: ReturnType<typeof setTimeout> | null } | null = null

function dismissActiveTooltip(): void {
  if (!activeTooltip) return
  if (activeTooltip.timer) { clearTimeout(activeTooltip.timer); activeTooltip.timer = null }
  activeTooltip.tip.classList.remove('visible')
  delete activeTooltip.tip.dataset.position
  activeTooltip = null
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

const vscode = acquireVsCodeApi()

// Cached references
let allPlans: SerializedPlanFile[] = []
let currentContextPlanId: string | null = null

// DOM references (populated after DOMContentLoaded)
let splitContainerEl: HTMLElement
let paneClaude: HTMLElement
let paneCursor: HTMLElement
let paneBodyClaude: HTMLElement
let paneBodyCursor: HTMLElement
let resizeHandleEl: HTMLElement
let searchInputEl: HTMLInputElement
let searchClearBtn: HTMLButtonElement
let contextMenuEl: HTMLElement
let emptyStateEl: HTMLElement
let noResultsEl: HTMLElement
let searchMenuEl: HTMLElement
let searchMenuToggleBtn: HTMLButtonElement

// Split-pane state
let splitRatio = 0.5
const MIN_PANE_HEIGHT = 32

// ---------------------------------------------------------------------------
// DOM ready
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  splitContainerEl = document.getElementById('split-container')!
  paneClaude = document.getElementById('pane-claude')!
  paneCursor = document.getElementById('pane-cursor')!
  paneBodyClaude = paneClaude.querySelector('.pane-body')! as HTMLElement
  paneBodyCursor = paneCursor.querySelector('.pane-body')! as HTMLElement
  resizeHandleEl = document.getElementById('resize-handle')!
  searchInputEl = document.querySelector('.search-input')! as HTMLInputElement
  searchClearBtn = document.querySelector('.search-clear')! as HTMLButtonElement
  contextMenuEl = document.getElementById('context-menu')!
  emptyStateEl = document.getElementById('empty-state')!
  noResultsEl = document.getElementById('no-results')!
  searchMenuEl = document.querySelector('.search-menu')! as HTMLElement
  searchMenuToggleBtn = document.querySelector('.search-menu-toggle')! as HTMLButtonElement

  // Restore quick state from vscode.getState()
  const cached = vscode.getState()
  if (cached?.searchQuery) {
    searchInputEl.value = cached.searchQuery
    searchClearBtn.hidden = false
  }

  setupSearchListeners()
  setupSearchMenu()
  setupActionListeners()
  setupContextMenu()
  setupKeyboardNavigation()
  setupResizeHandle()

  // Request initial data
  vscode.postMessage({ type: 'ready' })
})

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const msg = event.data
  switch (msg.type) {
    case 'plansLoaded':
      allPlans = msg.plans
      renderPlans(msg.plans)
      // Re-apply search filter if active
      if (searchInputEl && searchInputEl.value.trim()) {
        applySearchFilter(searchInputEl.value.trim())
      }
      break

    case 'focusSearch':
      if (searchInputEl) {
        searchInputEl.focus()
        searchInputEl.select()
      }
      break

    case 'clearSearch':
      if (searchInputEl) {
        searchInputEl.value = ''
        searchClearBtn.hidden = true
        clearSearchFilter()
        vscode.postMessage({ type: 'searchStateChanged', isActive: false })
      }
      break

    case 'configChanged':
      break

    case 'restoreState':
      restoreState(msg)
      break

    case 'commandError':
      // Could show inline error; for now just log
      console.error(`Command ${msg.command} failed for ${msg.planId}: ${msg.message}`)
      break
  }
})

// ---------------------------------------------------------------------------
// Task 5: DOM Rendering
// ---------------------------------------------------------------------------

/** Query all plan cards across both panes */
function queryAllCards(selector: string = '.plan-card'): HTMLElement[] {
  return [
    ...Array.from(paneBodyClaude.querySelectorAll<HTMLElement>(selector)),
    ...Array.from(paneBodyCursor.querySelectorAll<HTMLElement>(selector)),
  ]
}

function renderPlans(plans: SerializedPlanFile[]): void {
  if (!splitContainerEl) return

  // Group by source
  const groups = new Map<string, SerializedPlanFile[]>()
  for (const plan of plans) {
    const key = plan.source
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(plan)
  }

  const claudePlans = groups.get('claude') || []
  const cursorPlans = groups.get('cursor') || []

  // Clear pane bodies (headers are static in HTML)
  paneBodyClaude.innerHTML = ''
  paneBodyCursor.innerHTML = ''

  // Render cards into respective pane bodies
  for (const plan of claudePlans) {
    paneBodyClaude.appendChild(createPlanCard(plan))
  }
  for (const plan of cursorPlans) {
    paneBodyCursor.appendChild(createPlanCard(plan))
  }

  // Restore collapsed state from cache
  const cached = vscode.getState()
  if (cached?.collapsedGroups) {
    for (const source of ['claude', 'cursor'] as const) {
      const pane = source === 'claude' ? paneClaude : paneCursor
      const header = pane.querySelector('.pane-header') as HTMLElement | null
      if (header) {
        const isCollapsed = cached.collapsedGroups.includes(source)
        header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
        pane.dataset.collapsed = isCollapsed ? 'true' : 'false'
      }
    }
  }

  // Restore split ratio from cache
  if (cached?.splitRatio != null) {
    splitRatio = cached.splitRatio
  }

  // Update pane visibility and layout
  updatePaneVisibility()

  noResultsEl.hidden = true
}

function updatePaneHeader(pane: HTMLElement, count: number): void {
  const countEl = pane.querySelector('.group-count')
  if (countEl) countEl.textContent = String(count)
}

function updatePaneVisibility(): void {
  const claudeCards = paneBodyClaude.querySelectorAll('.plan-card:not(.hidden)')
  const cursorCards = paneBodyCursor.querySelectorAll('.plan-card:not(.hidden)')
  const claudeCount = claudeCards.length
  const cursorCount = cursorCards.length

  // Both panes are always visible (headers always shown)
  paneClaude.hidden = false
  paneCursor.hidden = false

  // Update header counts
  updatePaneHeader(paneClaude, claudeCount)
  updatePaneHeader(paneCursor, cursorCount)

  // Mark empty state via data-empty (does NOT touch user's data-collapsed preference)
  paneClaude.dataset.empty = claudeCount === 0 ? 'true' : 'false'
  paneCursor.dataset.empty = cursorCount === 0 ? 'true' : 'false'

  if (claudeCount === 0 && cursorCount === 0) {
    resizeHandleEl.hidden = true
    emptyStateEl.hidden = false
    return
  }

  emptyStateEl.hidden = true

  if (claudeCount === 0) {
    // Claude 0 — header only, Cursor takes remaining space
    resizeHandleEl.hidden = true
    paneCursor.style.flex = '1'
    return
  }

  if (cursorCount === 0) {
    // Cursor 0 — header only, Claude takes remaining space
    resizeHandleEl.hidden = true
    paneClaude.style.flex = '1'
    return
  }

  // Both have plans — show resize handle, apply split ratio
  resizeHandleEl.hidden = false
  applySplitRatio()
}

function createPlanCard(plan: SerializedPlanFile): HTMLElement {
  const card = document.createElement('div')
  card.className = 'plan-card'
  card.setAttribute('role', 'option')
  card.setAttribute('tabindex', '-1')
  card.dataset.planId = plan.filePath
  card.dataset.source = plan.source
  card.dataset.fileName = plan.fileName
  card.dataset.name = plan.name
  card.dataset.searchableBody = plan.searchableBody
  card.dataset.size = String(plan.size)
  card.dataset.modifiedAt = plan.modifiedAt
  card.dataset.description = plan.description || ''
  if (plan.todoProgress) {
    card.dataset.todoDone = String(plan.todoProgress.done)
    card.dataset.todoTotal = String(plan.todoProgress.total)
  }

  // Line 1: title + date
  const line1 = document.createElement('div')
  line1.className = 'card-line card-line-title'

  const titleSpan = document.createElement('span')
  titleSpan.className = 'card-title'
  titleSpan.textContent = plan.name
  line1.appendChild(titleSpan)

  const dateSpan = document.createElement('span')
  dateSpan.className = 'card-date'
  dateSpan.textContent = formatDate(plan.modifiedAt)
  line1.appendChild(dateSpan)

  card.appendChild(line1)

  // Line 2: description
  const line2 = document.createElement('div')
  line2.className = 'card-line card-line-desc'

  const descSpan = document.createElement('span')
  descSpan.className = 'card-description'
  if (plan.description) {
    descSpan.textContent = plan.description
  } else {
    descSpan.innerHTML = '&nbsp;'
  }
  line2.appendChild(descSpan)

  card.appendChild(line2)

  // Line 3: filename + progress
  const line3 = document.createElement('div')
  line3.className = 'card-line card-line-meta'

  const fileSpan = document.createElement('span')
  fileSpan.className = 'card-filename'
  fileSpan.textContent = plan.fileName
  line3.appendChild(fileSpan)

  if (plan.todoProgress) {
    const progress = plan.todoProgress
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

    const progressWrap = document.createElement('span')
    progressWrap.className = 'card-progress'

    const bar = document.createElement('span')
    bar.className = 'progress-bar'
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-valuenow', String(progress.done))
    bar.setAttribute('aria-valuemax', String(progress.total))

    const fill = document.createElement('span')
    fill.className = 'progress-fill'
    fill.style.width = `${pct}%`
    bar.appendChild(fill)

    const text = document.createElement('span')
    text.className = 'progress-text'
    text.textContent = `${progress.done}/${progress.total}`

    progressWrap.appendChild(bar)
    progressWrap.appendChild(text)
    line3.appendChild(progressWrap)
  }

  card.appendChild(line3)

  // Line 4: action buttons
  const line4 = document.createElement('div')
  line4.className = 'card-line card-line-actions'

  const convertAction = plan.source === 'claude' ? 'convertToCursor' : 'convertToClaude'

  const buttons: Array<{ action: string; tip: string; icon: string }> = [
    { action: convertAction, tip: t('convert'), icon: 'codicon-arrow-swap' },
    { action: 'openInPreview', tip: t('editor'), icon: 'codicon-go-to-file' },
    { action: 'openInCursor', tip: t('cursor'), icon: 'codicon-terminal-bash' },
    { action: 'openInCursorAgent', tip: t('agent'), icon: 'codicon-hubot' },
    { action: 'openInClaude', tip: t('claude'), icon: 'codicon-comment-discussion' },
  ]

  for (const btnDef of buttons) {
    const btn = document.createElement('button')
    btn.className = 'action-btn'
    btn.dataset.action = btnDef.action
    btn.setAttribute('tabindex', '-1')
    const icon = document.createElement('i')
    icon.className = `codicon ${btnDef.icon}`
    btn.appendChild(icon)
    const btnTip = document.createElement('span')
    btnTip.className = 'btn-tooltip'
    btnTip.textContent = btnDef.tip
    btn.appendChild(btnTip)
    line4.appendChild(btn)
  }

  // Separator
  const sep = document.createElement('span')
  sep.className = 'action-separator'
  sep.setAttribute('aria-hidden', 'true')
  line4.appendChild(sep)

  const utilButtons: Array<{ action: string; tip: string; icon: string }> = [
    { action: 'copyPath', tip: t('copy'), icon: 'codicon-files' },
    { action: 'revealInOS', tip: t('reveal'), icon: 'codicon-folder-opened' },
  ]

  for (const btnDef of utilButtons) {
    const btn = document.createElement('button')
    btn.className = 'action-btn'
    btn.dataset.action = btnDef.action
    btn.setAttribute('tabindex', '-1')
    const icon = document.createElement('i')
    icon.className = `codicon ${btnDef.icon}`
    btn.appendChild(icon)
    const btnTip = document.createElement('span')
    btnTip.className = 'btn-tooltip'
    btnTip.textContent = btnDef.tip
    btn.appendChild(btnTip)
    line4.appendChild(btn)
  }

  card.appendChild(line4)

  // Tooltip: JS-controlled via global activeTooltip singleton
  const tip = buildTooltipEl(plan)
  card.appendChild(tip)

  function cancelTip(): void {
    if (activeTooltip && activeTooltip.tip === tip) {
      dismissActiveTooltip()
    }
  }

  function scheduleTip(): void {
    // Dismiss any other card's tooltip first
    dismissActiveTooltip()
    const timer = setTimeout(showTip, 400)
    activeTooltip = { tip, timer }
  }

  function showTip(): void {
    const cardRect = card.getBoundingClientRect()
    const vpHeight = window.innerHeight

    tip.style.left = `${cardRect.left}px`
    tip.style.width = `${cardRect.width}px`

    // Measure tooltip height while hidden
    tip.style.top = '0px'
    tip.classList.add('visible')
    tip.style.visibility = 'hidden'
    const tipHeight = tip.offsetHeight
    tip.style.visibility = ''

    // Top 50% of viewport → show below card; Bottom 50% → show above card
    let topPos: number
    let position: 'below' | 'above'
    if (cardRect.top < vpHeight / 2) {
      topPos = cardRect.bottom + 6
      position = 'below'
    } else {
      topPos = cardRect.top - tipHeight - 6
      position = 'above'
    }
    tip.dataset.position = position

    // Clamp to viewport bounds
    topPos = Math.max(4, Math.min(topPos, vpHeight - tipHeight - 4))
    tip.style.top = `${topPos}px`

    activeTooltip = { tip, timer: null }
  }

  function isOnActionBtn(e: MouseEvent): boolean {
    return (e.target as HTMLElement).closest('.action-btn') !== null
  }

  card.addEventListener('mouseenter', (e) => {
    if (isOnActionBtn(e as MouseEvent)) return
    scheduleTip()
  })

  card.addEventListener('mouseleave', () => cancelTip())

  card.addEventListener('mouseover', (e) => {
    if (isOnActionBtn(e as MouseEvent)) {
      cancelTip()
    } else if (!activeTooltip || activeTooltip.tip !== tip) {
      scheduleTip()
    }
  })

  return card
}

function buildTooltipEl(plan: SerializedPlanFile): HTMLElement {
  const tip = document.createElement('div')
  tip.className = 'card-tooltip'

  const lines: string[] = []
  lines.push(`<div class="tooltip-title">${escapeHtml(plan.name)}</div>`)
  lines.push(`<div class="tooltip-row"><span class="tooltip-label">Path:</span> <span class="tooltip-value">${escapeHtml(plan.filePath)}</span></div>`)
  lines.push(`<div class="tooltip-row"><span class="tooltip-label">Size:</span> ${(plan.size / 1024).toFixed(1)} KB</div>`)

  if (plan.modifiedAt) {
    const d = new Date(plan.modifiedAt)
    if (!isNaN(d.getTime())) {
      lines.push(`<div class="tooltip-row"><span class="tooltip-label">Modified:</span> ${d.toLocaleString()}</div>`)
    }
  }

  if (plan.todoProgress) {
    const { done, total } = plan.todoProgress
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    lines.push(`<div class="tooltip-progress">`)
    lines.push(`<span class="tooltip-label">Progress:</span>`)
    lines.push(`<span class="tooltip-progress-bar"><span class="tooltip-progress-fill" style="width:${pct}%"></span></span>`)
    lines.push(`<span>${pct}% (${done}/${total})</span>`)
    lines.push(`</div>`)
  }

  if (plan.description) {
    lines.push(`<div class="tooltip-sep"></div>`)
    lines.push(`<div class="tooltip-desc">${escapeHtml(plan.description)}</div>`)
  }

  const content = document.createElement('div')
  content.className = 'card-tooltip-content'
  content.innerHTML = lines.join('')
  tip.appendChild(content)
  return tip
}

// ---------------------------------------------------------------------------
// Split-pane resize logic
// ---------------------------------------------------------------------------

function setupResizeHandle(): void {
  let isDragging = false
  let startY = 0
  let startTopHeight = 0
  let totalHeight = 0

  resizeHandleEl.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
    isDragging = true
    startY = e.clientY
    const containerRect = splitContainerEl.getBoundingClientRect()
    totalHeight = containerRect.height - resizeHandleEl.offsetHeight
    startTopHeight = paneClaude.offsetHeight

    resizeHandleEl.classList.add('active')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return
    const delta = e.clientY - startY
    let newTopHeight = startTopHeight + delta

    // Clamp to min pane height
    newTopHeight = Math.max(MIN_PANE_HEIGHT, Math.min(newTopHeight, totalHeight - MIN_PANE_HEIGHT))

    splitRatio = newTopHeight / totalHeight
    applySplitRatio()
  })

  document.addEventListener('mouseup', () => {
    if (!isDragging) return
    isDragging = false
    resizeHandleEl.classList.remove('active')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    notifyStateChanged()
  })

  // Keyboard resize (ArrowUp/Down when handle is focused)
  resizeHandleEl.addEventListener('keydown', (e: KeyboardEvent) => {
    const step = 0.05
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      splitRatio = Math.max(0.05, splitRatio - step)
      applySplitRatio()
      notifyStateChanged()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      splitRatio = Math.min(0.95, splitRatio + step)
      applySplitRatio()
      notifyStateChanged()
    }
  })

  // Attach pane header click listeners (static HTML headers)
  const claudeHeader = paneClaude.querySelector('.pane-header') as HTMLElement | null
  const cursorHeader = paneCursor.querySelector('.pane-header') as HTMLElement | null
  if (claudeHeader) claudeHeader.addEventListener('click', () => toggleGroup(claudeHeader))
  if (cursorHeader) cursorHeader.addEventListener('click', () => toggleGroup(cursorHeader))
}

function applySplitRatio(): void {
  const claudeMinimized = paneClaude.dataset.collapsed === 'true' || paneClaude.dataset.empty === 'true'
  const cursorMinimized = paneCursor.dataset.collapsed === 'true' || paneCursor.dataset.empty === 'true'

  // Hide resize handle whenever resizing is not possible
  if (claudeMinimized || cursorMinimized) {
    resizeHandleEl.hidden = true

    if (claudeMinimized && cursorMinimized) {
      paneClaude.style.flex = '0 0 auto'
      paneCursor.style.flex = '0 0 auto'
    } else if (claudeMinimized) {
      paneClaude.style.flex = '0 0 auto'
      paneCursor.style.flex = '1'
    } else {
      paneClaude.style.flex = '1'
      paneCursor.style.flex = '0 0 auto'
    }
    return
  }

  // Both expanded: show handle, apply ratio
  resizeHandleEl.hidden = false
  paneClaude.style.flex = `${splitRatio} 1 0`
  paneCursor.style.flex = `${1 - splitRatio} 1 0`

  // Update ARIA
  resizeHandleEl.setAttribute('aria-valuenow', String(Math.round(splitRatio * 100)))
}

// ---------------------------------------------------------------------------
// Task 6: Search filtering
// ---------------------------------------------------------------------------

function setupSearchListeners(): void {
  const debouncedSearch = debounce((_: unknown) => {
    const query = searchInputEl.value.trim()
    searchClearBtn.hidden = query.length === 0

    if (query.length === 0) {
      clearSearchFilter()
      vscode.postMessage({ type: 'searchStateChanged', isActive: false })
    } else {
      applySearchFilter(query)
      vscode.postMessage({ type: 'searchStateChanged', isActive: true })
    }

    notifyStateChanged()
  }, 150)

  searchInputEl.addEventListener('input', debouncedSearch)

  searchInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchInputEl.value = ''
      searchClearBtn.hidden = true
      clearSearchFilter()
      vscode.postMessage({ type: 'searchStateChanged', isActive: false })
      // Move focus to first visible card
      const allCards = queryAllCards('.plan-card:not(.hidden)')
      const firstCard = allCards[0] || null
      if (firstCard) {
        focusCard(firstCard)
      }
      notifyStateChanged()
    }
  })

  searchClearBtn.addEventListener('click', () => {
    searchInputEl.value = ''
    searchClearBtn.hidden = true
    clearSearchFilter()
    searchInputEl.focus()
    vscode.postMessage({ type: 'searchStateChanged', isActive: false })
    notifyStateChanged()
  })

  // Clear search link in no-results state
  const clearLink = document.getElementById('clear-search-link')
  if (clearLink) {
    clearLink.addEventListener('click', (e) => {
      e.preventDefault()
      searchInputEl.value = ''
      searchClearBtn.hidden = true
      clearSearchFilter()
      searchInputEl.focus()
      vscode.postMessage({ type: 'searchStateChanged', isActive: false })
      notifyStateChanged()
    })
  }
}

// ---------------------------------------------------------------------------
// Search dropdown menu
// ---------------------------------------------------------------------------

function setupSearchMenu(): void {
  // Toggle menu visibility
  searchMenuToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = !searchMenuEl.hidden
    if (isOpen) {
      closeSearchMenu()
    } else {
      openSearchMenu()
    }
  })

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!searchMenuEl.hidden && !searchMenuEl.contains(e.target as Node)) {
      closeSearchMenu()
    }
  })

  // Menu item actions
  searchMenuEl.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.search-menu-item') as HTMLElement | null
    if (!item) return

    const action = item.dataset.action
    switch (action) {
      case 'clearSearch':
        searchInputEl.value = ''
        searchClearBtn.hidden = true
        clearSearchFilter()
        searchInputEl.focus()
        vscode.postMessage({ type: 'searchStateChanged', isActive: false })
        notifyStateChanged()
        break

      case 'refresh':
        vscode.postMessage({ type: 'requestRefresh' })
        break

      case 'toggleAll': {
        const headers = Array.from(document.querySelectorAll<HTMLElement>('.pane-header'))
        const allCollapsed = headers.every(h => h.getAttribute('aria-expanded') === 'false')
        for (const h of headers) {
          h.setAttribute('aria-expanded', allCollapsed ? 'true' : 'false')
          const pane = h.closest('.split-pane') as HTMLElement | null
          if (pane) pane.dataset.collapsed = allCollapsed ? 'false' : 'true'
        }
        applySplitRatio()
        notifyStateChanged()
        break
      }

      case 'toggleClaude': {
        const header = document.querySelector<HTMLElement>('.pane-header[data-group="claude"]')
        if (header) toggleGroup(header)
        break
      }

      case 'toggleCursor': {
        const header = document.querySelector<HTMLElement>('.pane-header[data-group="cursor"]')
        if (header) toggleGroup(header)
        break
      }
    }

    closeSearchMenu()
  })
}

function openSearchMenu(): void {
  // Update labels based on current group states before showing
  updateSearchMenuLabels()
  searchMenuEl.hidden = false
  searchMenuToggleBtn.setAttribute('aria-expanded', 'true')
}

function closeSearchMenu(): void {
  searchMenuEl.hidden = true
  searchMenuToggleBtn.setAttribute('aria-expanded', 'false')
}

function updateSearchMenuLabels(): void {
  const headers = Array.from(document.querySelectorAll<HTMLElement>('.pane-header'))
  const allCollapsed = headers.length > 0 && headers.every(h => h.getAttribute('aria-expanded') === 'false')

  // Toggle all label
  const toggleAllItem = searchMenuEl.querySelector('[data-action="toggleAll"] .menu-label') as HTMLElement | null
  if (toggleAllItem) {
    toggleAllItem.textContent = allCollapsed ? t('expandAll') : t('collapseAll')
  }
  // Toggle all icon
  const toggleAllIcon = searchMenuEl.querySelector('[data-action="toggleAll"] i') as HTMLElement | null
  if (toggleAllIcon) {
    toggleAllIcon.className = allCollapsed ? 'codicon codicon-expand-all' : 'codicon codicon-collapse-all'
  }

  // Claude group label
  const claudeHeader = document.querySelector<HTMLElement>('.pane-header[data-group="claude"]')
  const claudeItem = searchMenuEl.querySelector('[data-action="toggleClaude"] .menu-label') as HTMLElement | null
  if (claudeItem) {
    const isExpanded = claudeHeader?.getAttribute('aria-expanded') === 'true'
    claudeItem.textContent = isExpanded ? t('closeClaude') : t('openClaude')
  }

  // Cursor group label
  const cursorHeader = document.querySelector<HTMLElement>('.pane-header[data-group="cursor"]')
  const cursorItem = searchMenuEl.querySelector('[data-action="toggleCursor"] .menu-label') as HTMLElement | null
  if (cursorItem) {
    const isExpanded = cursorHeader?.getAttribute('aria-expanded') === 'true'
    cursorItem.textContent = isExpanded ? t('closeCursor') : t('openCursor')
  }
}

function applySearchFilter(query: string): void {
  const lowerQuery = query.toLowerCase()
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi')
  const cards = queryAllCards()
  let totalVisible = 0

  for (const card of cards) {
    const fileName = card.dataset.fileName || ''
    const name = card.dataset.name || ''
    const searchableBody = card.dataset.searchableBody || ''

    const matches =
      fileName.toLowerCase().includes(lowerQuery) ||
      name.toLowerCase().includes(lowerQuery) ||
      searchableBody.toLowerCase().includes(lowerQuery)

    if (matches) {
      card.classList.remove('hidden')
      totalVisible++
      // Highlight title
      const titleEl = card.querySelector('.card-title') as HTMLElement | null
      if (titleEl) {
        titleEl.innerHTML = escapeHtml(name).replace(regex, '<mark class="search-highlight">$1</mark>')
      }
      // Highlight filename
      const fileEl = card.querySelector('.card-filename') as HTMLElement | null
      if (fileEl) {
        fileEl.innerHTML = escapeHtml(fileName).replace(regex, '<mark class="search-highlight">$1</mark>')
      }
    } else {
      card.classList.add('hidden')
      // Reset highlights
      const titleEl = card.querySelector('.card-title') as HTMLElement | null
      if (titleEl) titleEl.textContent = name
      const fileEl = card.querySelector('.card-filename') as HTMLElement | null
      if (fileEl) fileEl.textContent = fileName
    }
  }

  // Update pane visibility and counts
  updatePaneVisibility()

  // Show no-results state
  if (totalVisible === 0 && allPlans.length > 0) {
    noResultsEl.hidden = false
  } else {
    noResultsEl.hidden = true
  }
}

function clearSearchFilter(): void {
  const cards = queryAllCards()
  for (const card of cards) {
    card.classList.remove('hidden')
    // Reset highlights
    const titleEl = card.querySelector('.card-title') as HTMLElement | null
    if (titleEl) titleEl.textContent = card.dataset.name || ''
    const fileEl = card.querySelector('.card-filename') as HTMLElement | null
    if (fileEl) fileEl.textContent = card.dataset.fileName || ''
  }
  updatePaneVisibility()
  noResultsEl.hidden = true
}

// ---------------------------------------------------------------------------
// Task 7: Action buttons and click events
// ---------------------------------------------------------------------------

function setupActionListeners(): void {
  // Event delegation on plan-list
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement

    // Close context menu on any click outside
    if (!contextMenuEl.hidden && !contextMenuEl.contains(target)) {
      hideContextMenu()
    }

    // Action button click
    const actionBtn = target.closest('.action-btn') as HTMLElement | null
    if (actionBtn) {
      e.stopPropagation()
      const card = actionBtn.closest('.plan-card') as HTMLElement | null
      if (card && actionBtn.dataset.action) {
        vscode.postMessage({
          type: 'command',
          command: actionBtn.dataset.action,
          planId: card.dataset.planId!,
        })
      }
      return
    }

    // Card body click (single)
    const card = target.closest('.plan-card') as HTMLElement | null
    if (card && card.dataset.planId) {
      focusCard(card)
      vscode.postMessage({
        type: 'command',
        command: 'openInPreview',
        planId: card.dataset.planId,
      })
    }
  })

  // Card body double-click
  document.addEventListener('dblclick', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    // Don't fire on action buttons
    if (target.closest('.action-btn')) return

    const card = target.closest('.plan-card') as HTMLElement | null
    if (card && card.dataset.planId) {
      vscode.postMessage({
        type: 'command',
        command: 'openInEditorPinned',
        planId: card.dataset.planId,
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Task 8: Context menu
// ---------------------------------------------------------------------------

function setupContextMenu(): void {
  // Right-click on plan card
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const card = target.closest('.plan-card') as HTMLElement | null
    if (!card) {
      hideContextMenu()
      return
    }

    e.preventDefault()
    currentContextPlanId = card.dataset.planId || null
    const source = card.dataset.source as 'claude' | 'cursor' | undefined

    showContextMenu(e.clientX, e.clientY, source || 'claude')
  })

  // Context menu item clicks
  contextMenuEl.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const item = target.closest('.context-menu-item') as HTMLElement | null
    if (!item) return

    const action = item.dataset.action
    if (action && currentContextPlanId) {
      vscode.postMessage({
        type: 'command',
        command: action,
        planId: currentContextPlanId,
      })
    }
    hideContextMenu()
  })

  // Dismiss on Escape
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !contextMenuEl.hidden) {
      e.preventDefault()
      e.stopPropagation()
      hideContextMenu()
    }
  })

  // Dismiss on scroll
  document.addEventListener('scroll', () => {
    if (!contextMenuEl.hidden) hideContextMenu()
  }, true)

  // Keyboard navigation in context menu
  contextMenuEl.addEventListener('keydown', (e: KeyboardEvent) => {
    const items = Array.from(contextMenuEl.querySelectorAll<HTMLElement>('.context-menu-item'))
    const current = document.activeElement as HTMLElement
    const idx = items.indexOf(current)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = idx < items.length - 1 ? idx + 1 : 0
      items[next].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = idx > 0 ? idx - 1 : items.length - 1
      items[prev].focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (current && current.classList.contains('context-menu-item')) {
        current.click()
      }
    }
  })
}

function showContextMenu(x: number, y: number, source: 'claude' | 'cursor'): void {
  // Update convert label based on source
  const convertItem = contextMenuEl.querySelector('[data-convert-item]') as HTMLElement | null
  if (convertItem) {
    if (source === 'claude') {
      convertItem.textContent = 'Convert to Cursor Plan'
      convertItem.dataset.action = 'convertToCursor'
    } else {
      convertItem.textContent = 'Convert to Claude Plan'
      convertItem.dataset.action = 'convertToClaude'
    }
  }

  contextMenuEl.hidden = false

  // Viewport clamping
  const rect = contextMenuEl.getBoundingClientRect()
  const viewW = window.innerWidth
  const viewH = window.innerHeight

  if (x + rect.width > viewW) x = viewW - rect.width - 4
  if (y + rect.height > viewH) y = viewH - rect.height - 4
  if (x < 0) x = 4
  if (y < 0) y = 4

  contextMenuEl.style.left = `${x}px`
  contextMenuEl.style.top = `${y}px`

  // Focus first item
  const firstItem = contextMenuEl.querySelector('.context-menu-item') as HTMLElement | null
  if (firstItem) firstItem.focus()
}

function hideContextMenu(): void {
  contextMenuEl.hidden = true
  currentContextPlanId = null
}

// ---------------------------------------------------------------------------
// Task 9: Keyboard navigation
// ---------------------------------------------------------------------------

function setupKeyboardNavigation(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Skip if context menu is open (handled separately)
    if (!contextMenuEl.hidden) return
    // Skip if search input is focused (except Escape handled in search listener)
    if (document.activeElement === searchInputEl) return

    const cards = getAllVisibleCards()
    const focused = document.activeElement as HTMLElement

    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        if (e.key === 'j' && isTyping()) return
        e.preventDefault()
        const isGroupHeader = focused?.classList.contains('pane-header')
        if (isGroupHeader) {
          // Move to first card in this pane
          const pane = focused.closest('.split-pane') as HTMLElement | null
          if (pane) {
            const paneBody = pane.querySelector('.pane-body') as HTMLElement | null
            if (paneBody) {
              const firstCard = paneBody.querySelector('.plan-card:not(.hidden)') as HTMLElement | null
              if (firstCard) { focusCard(firstCard); return }
            }
          }
        }
        const idx = cards.indexOf(focused)
        const next = idx < cards.length - 1 ? idx + 1 : 0
        if (cards[next]) focusCard(cards[next])
        break
      }

      case 'ArrowUp':
      case 'k': {
        if (e.key === 'k' && isTyping()) return
        e.preventDefault()
        const idx = cards.indexOf(focused)
        const prev = idx > 0 ? idx - 1 : cards.length - 1
        if (cards[prev]) focusCard(cards[prev])
        break
      }

      case 'Home': {
        e.preventDefault()
        if (cards.length > 0) focusCard(cards[0])
        break
      }

      case 'End': {
        e.preventDefault()
        if (cards.length > 0) focusCard(cards[cards.length - 1])
        break
      }

      case 'Enter': {
        if (focused?.classList.contains('plan-card') && focused.dataset.planId) {
          e.preventDefault()
          vscode.postMessage({
            type: 'command',
            command: 'openInEditor',
            planId: focused.dataset.planId,
          })
        } else if (focused?.classList.contains('pane-header')) {
          e.preventDefault()
          toggleGroup(focused)
        }
        break
      }

      case 'F10': {
        if (e.shiftKey && focused?.classList.contains('plan-card')) {
          e.preventDefault()
          const rect = focused.getBoundingClientRect()
          currentContextPlanId = focused.dataset.planId || null
          const source = focused.dataset.source as 'claude' | 'cursor' || 'claude'
          showContextMenu(rect.left + 16, rect.top + rect.height / 2, source)
        }
        break
      }

      case 'Tab': {
        // Cycle through action buttons within focused card
        if (focused?.classList.contains('plan-card') || focused?.closest('.plan-card')) {
          const card = focused.classList.contains('plan-card')
            ? focused
            : focused.closest('.plan-card') as HTMLElement
          if (!card) break

          const actionBtns = Array.from(card.querySelectorAll<HTMLElement>('.action-btn'))
          if (actionBtns.length === 0) break

          e.preventDefault()
          const currentBtn = focused.closest('.action-btn') as HTMLElement | null
          if (!currentBtn || !actionBtns.includes(currentBtn)) {
            // Focus first action button
            actionBtns[0].setAttribute('tabindex', '0')
            actionBtns[0].focus()
          } else {
            const btnIdx = actionBtns.indexOf(currentBtn)
            currentBtn.setAttribute('tabindex', '-1')
            if (e.shiftKey) {
              const prevIdx = btnIdx > 0 ? btnIdx - 1 : actionBtns.length - 1
              // If wrapping back, return to card
              if (btnIdx === 0) {
                focusCard(card)
              } else {
                actionBtns[prevIdx].setAttribute('tabindex', '0')
                actionBtns[prevIdx].focus()
              }
            } else {
              const nextIdx = btnIdx + 1
              if (nextIdx >= actionBtns.length) {
                // Return focus to card
                focusCard(card)
              } else {
                actionBtns[nextIdx].setAttribute('tabindex', '0')
                actionBtns[nextIdx].focus()
              }
            }
          }
        }
        break
      }

      case 'ArrowLeft': {
        if (focused?.classList.contains('plan-card')) {
          // Move to parent pane header
          e.preventDefault()
          const pane = focused.closest('.split-pane') as HTMLElement | null
          if (pane) {
            const header = pane.querySelector('.pane-header') as HTMLElement | null
            if (header) header.focus()
          }
        } else if (focused?.classList.contains('pane-header')) {
          // Collapse group
          e.preventDefault()
          if (focused.getAttribute('aria-expanded') === 'true') {
            toggleGroup(focused)
          }
        }
        break
      }

      case 'ArrowRight': {
        if (focused?.classList.contains('pane-header')) {
          // Expand group
          e.preventDefault()
          if (focused.getAttribute('aria-expanded') === 'false') {
            toggleGroup(focused)
          }
        }
        break
      }
    }
  })
}

function isTyping(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable
}

function getAllVisibleCards(): HTMLElement[] {
  return queryAllCards('.plan-card:not(.hidden)')
}

function focusCard(card: HTMLElement): void {
  // Remove tabindex from previously focused card across both panes
  const prevCards = queryAllCards('.plan-card[tabindex="0"]')
  for (const prev of prevCards) {
    if (prev !== card) {
      prev.setAttribute('tabindex', '-1')
      prev.setAttribute('aria-selected', 'false')
    }
  }

  card.setAttribute('tabindex', '0')
  card.setAttribute('aria-selected', 'true')
  card.focus()
  card.scrollIntoView({ block: 'nearest' })

  notifyStateChanged()
}

// ---------------------------------------------------------------------------
// Task 10: Group collapse and state management
// ---------------------------------------------------------------------------

function toggleGroup(header: HTMLElement): void {
  const expanded = header.getAttribute('aria-expanded') === 'true'
  header.setAttribute('aria-expanded', expanded ? 'false' : 'true')

  // Set data-collapsed on parent pane for CSS-driven collapse
  const pane = header.closest('.split-pane') as HTMLElement | null
  if (pane) {
    pane.dataset.collapsed = expanded ? 'true' : 'false'
  }

  // Recalculate layout
  applySplitRatio()
  notifyStateChanged()
}

/** Debounced state change notification to extension host */
const notifyStateChanged = debounce((_?: unknown) => {
  const state = buildCurrentState()
  vscode.setState(state)
  vscode.postMessage({ type: 'stateChanged', ...state })
}, 500)

function buildCurrentState(): PersistedWebviewState {
  const collapsedGroups: string[] = []
  const headers = Array.from(document.querySelectorAll<HTMLElement>('.pane-header'))
  for (const h of headers) {
    if (h.getAttribute('aria-expanded') === 'false' && h.dataset.group) {
      collapsedGroups.push(h.dataset.group)
    }
  }

  const focusedCard = document.querySelector('.plan-card[aria-selected="true"]') as HTMLElement | null

  return {
    collapsedGroups,
    scrollTop: 0,
    focusedPlanId: focusedCard?.dataset.planId ?? null,
    searchQuery: searchInputEl?.value ?? '',
    splitRatio,
    paneScrollTops: {
      claude: paneBodyClaude?.scrollTop ?? 0,
      cursor: paneBodyCursor?.scrollTop ?? 0,
    },
  }
}

function restoreState(state: PersistedWebviewState): void {
  // Restore search query
  if (state.searchQuery && searchInputEl) {
    searchInputEl.value = state.searchQuery
    searchClearBtn.hidden = state.searchQuery.length === 0
    if (state.searchQuery.trim()) {
      applySearchFilter(state.searchQuery.trim())
      vscode.postMessage({ type: 'searchStateChanged', isActive: true })
    }
  }

  // Restore collapsed groups
  if (state.collapsedGroups) {
    for (const source of ['claude', 'cursor'] as const) {
      const pane = source === 'claude' ? paneClaude : paneCursor
      const header = pane?.querySelector('.pane-header') as HTMLElement | null
      if (header && pane) {
        const isCollapsed = state.collapsedGroups.includes(source)
        header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
        pane.dataset.collapsed = isCollapsed ? 'true' : 'false'
      }
    }
  }

  // Restore split ratio
  if (state.splitRatio != null) {
    splitRatio = state.splitRatio
  }
  applySplitRatio()

  // Restore per-pane scroll positions
  if (state.paneScrollTops) {
    requestAnimationFrame(() => {
      if (paneBodyClaude) paneBodyClaude.scrollTop = state.paneScrollTops!.claude
      if (paneBodyCursor) paneBodyCursor.scrollTop = state.paneScrollTops!.cursor
    })
  }

  // Restore focused card
  if (state.focusedPlanId) {
    requestAnimationFrame(() => {
      const allCards = queryAllCards()
      const card = allCards.find(c => c.dataset.planId === state.focusedPlanId) || null
      if (card) {
        focusCard(card)
      }
    })
  }

  // Persist to webview state
  vscode.setState(state)
}

// Save state on per-pane scroll
document.addEventListener('DOMContentLoaded', () => {
  paneBodyClaude.addEventListener('scroll', () => notifyStateChanged(), { passive: true })
  paneBodyCursor.addEventListener('scroll', () => notifyStateChanged(), { passive: true })
})

