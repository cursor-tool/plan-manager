import * as vscode from 'vscode'
import * as crypto from 'crypto'
import { PlanFile, PlanSource, TodoStatus } from '../types/plan'
import {
  SerializedPlanFile,
  PersistedWebviewState,
  WebviewToHostMessage,
} from '../types/messages'
import { PlanDiscoveryService } from './planDiscoveryService'
import { extractFirstParagraph } from '../utils/markdownParser'

// ---------------------------------------------------------------------------
// Helpers (ported from treeDataProvider.ts)
// ---------------------------------------------------------------------------

/** MM-DD HH:mm format — ported from treeDataProvider.ts:55-61 */
function formatDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

// ---------------------------------------------------------------------------
// State persistence key
// ---------------------------------------------------------------------------

const STATE_KEY = 'planManager.webviewState'

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PlanWebviewViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'planManagerView'

  private _view?: vscode.WebviewView
  private _disposables: vscode.Disposable[] = []
  private _pendingState: PersistedWebviewState | null = null
  private _stateDebounceTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _discovery: PlanDiscoveryService,
  ) {}

  // -----------------------------------------------------------------------
  // WebviewViewProvider
  // -----------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView

    const extensionUri = this._context.extensionUri

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'out', 'webview'),
      ],
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Message handler
    this._disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: unknown) => {
        this._handleMessage(msg as WebviewToHostMessage)
      }),
    )

    // Restore state when the panel becomes visible again
    this._disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this._sendRestoreState()
        }
      }),
    )

    // Flush pending state on dispose
    webviewView.onDidDispose(() => {
      this._flushState()
      this._view = undefined
    })
  }

  // -----------------------------------------------------------------------
  // HTML generation
  // -----------------------------------------------------------------------

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const locale = vscode.env.language === 'ja' ? 'ja' : 'en'
    const nonce = crypto.randomBytes(16).toString('hex')
    const extensionUri = this._context.extensionUri
    const cspSource = webview.cspSource

    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'codicon.css'),
    )
    const stylesCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'styles.css'),
    )
    const mainJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js'),
    )

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <link rel="stylesheet" href="${codiconCssUri}">
  <link rel="stylesheet" href="${stylesCssUri}">
  <title>Plan Manager</title>
</head>
<body data-locale="${locale}">
  <!-- Search bar (sticky top) -->
  <div class="search-container">
    <div class="search-input-wrapper">
      <input type="text" class="search-input" placeholder="Search plans..." aria-label="Search plans" spellcheck="false" autocomplete="off">
      <button class="search-inner-btn search-clear" title="Clear search" hidden aria-label="Clear search"><i class="codicon codicon-close"></i></button>
      <button class="search-inner-btn search-menu-toggle" title="Menu" aria-label="Menu" aria-haspopup="true" aria-expanded="false"><i class="codicon codicon-ellipsis"></i></button>
    </div>
    <!-- Dropdown menu -->
    <div class="search-menu" hidden role="menu">
      <button class="search-menu-item" role="menuitem" data-action="clearSearch"><i class="codicon codicon-clear-all"></i> ${locale === 'ja' ? '検索リセット' : 'Reset Search'}</button>
      <button class="search-menu-item" role="menuitem" data-action="refresh"><i class="codicon codicon-refresh"></i> ${locale === 'ja' ? '更新' : 'Refresh'}</button>
      <div class="search-menu-separator" role="separator"></div>
      <button class="search-menu-item" role="menuitem" data-action="toggleAll"><i class="codicon codicon-expand-all"></i> <span class="menu-label">${locale === 'ja' ? '全て閉じる' : 'Collapse All'}</span></button>
      <button class="search-menu-item" role="menuitem" data-action="toggleClaude"><i class="codicon codicon-chevron-right"></i> <span class="menu-label">${locale === 'ja' ? 'CLAUDE CODE PLANを閉じる' : 'Close CLAUDE CODE PLAN'}</span></button>
      <button class="search-menu-item" role="menuitem" data-action="toggleCursor"><i class="codicon codicon-chevron-right"></i> <span class="menu-label">${locale === 'ja' ? 'CURSOR PLANを閉じる' : 'Close CURSOR PLAN'}</span></button>
    </div>
  </div>

  <!-- Split-pane container -->
  <div id="split-container" class="split-container">
    <!-- Claude pane -->
    <div id="pane-claude" class="split-pane" data-pane="claude">
      <div class="pane-header group-header" role="button" aria-expanded="true" tabindex="0" data-group="claude">
        <span class="codicon codicon-chevron-down group-chevron"></span>
        <span class="group-label">CLAUDE CODE PLANS</span>
        <span class="group-count">0</span>
      </div>
      <div class="pane-body plan-list" data-group-body="claude" role="listbox"></div>
    </div>

    <!-- Resize handle -->
    <div id="resize-handle" class="resize-handle" role="separator" aria-orientation="horizontal" aria-valuenow="50" tabindex="0">
      <div class="resize-handle-bar"></div>
    </div>

    <!-- Cursor pane -->
    <div id="pane-cursor" class="split-pane" data-pane="cursor">
      <div class="pane-header group-header" role="button" aria-expanded="true" tabindex="0" data-group="cursor">
        <span class="codicon codicon-chevron-down group-chevron"></span>
        <span class="group-label">CURSOR PLANS</span>
        <span class="group-count">0</span>
      </div>
      <div class="pane-body plan-list" data-group-body="cursor" role="listbox"></div>
    </div>
  </div>

  <!-- Empty state: no plans -->
  <div id="empty-state" class="empty-state" role="status" hidden>
    <i class="codicon codicon-inbox empty-state-icon" aria-hidden="true"></i>
    <p class="empty-state-title">No plan files found</p>
    <p class="empty-state-detail">Scanning: ~/.claude/plans, ~/.cursor/plans</p>
  </div>

  <!-- Empty state: no search results -->
  <div id="no-results" class="empty-state" role="status" hidden>
    <i class="codicon codicon-search empty-state-icon" aria-hidden="true"></i>
    <p class="empty-state-title">No plans match your search</p>
    <p class="empty-state-detail"><a href="#" class="empty-state-link" id="clear-search-link">Clear search</a></p>
  </div>

  <!-- Context menu -->
  <div id="context-menu" class="context-menu" role="menu" hidden>
    <button class="context-menu-item" role="menuitem" data-convert-item data-action="convert">Convert</button>
    <div class="context-menu-separator" role="separator"></div>
    <button class="context-menu-item" role="menuitem" data-action="openInEditor">Open in Editor</button>
    <button class="context-menu-item" role="menuitem" data-action="openInCursor">Open in Cursor</button>
    <button class="context-menu-item" role="menuitem" data-action="openInCursorAgent">Open in Cursor Agent</button>
    <button class="context-menu-item" role="menuitem" data-action="openInClaude">Open in Claude</button>
    <div class="context-menu-separator" role="separator"></div>
    <button class="context-menu-item" role="menuitem" data-action="copyPath">Copy Path</button>
    <button class="context-menu-item" role="menuitem" data-action="revealInOS">Reveal in File Explorer</button>
  </div>

  <script nonce="${nonce}" src="${mainJsUri}"></script>
</body>
</html>`
  }

  // -----------------------------------------------------------------------
  // Data serialization
  // -----------------------------------------------------------------------

  /** Convert a PlanFile to a SerializedPlanFile for the webview. */
  serializePlanFile(plan: PlanFile): SerializedPlanFile {
    let description: string
    if (plan.source === PlanSource.Cursor) {
      description = plan.frontmatter?.overview?.slice(0, 200) ?? ''
    } else {
      description = extractFirstParagraph(plan.markdownBody)?.slice(0, 200) ?? ''
    }

    let todoProgress: { done: number; total: number } | null = null
    if (plan.frontmatter?.todos?.length) {
      const done = plan.frontmatter.todos.filter((t) => t.status === TodoStatus.Completed).length
      const total = plan.frontmatter.todos.length
      todoProgress = { done, total }
    }

    return {
      filePath: plan.filePath,
      fileName: plan.fileName,
      source: plan.source === PlanSource.ClaudeCode ? 'claude' : 'cursor',
      name: plan.name,
      description,
      modifiedAt: plan.modifiedAt.toISOString(),
      size: plan.size,
      searchableBody: plan.markdownBody.slice(0, 2000),
      todoProgress,
    }
  }

  // -----------------------------------------------------------------------
  // Sorting (ported from treeDataProvider.ts:152-158)
  // -----------------------------------------------------------------------

  private _sortPlans(plans: PlanFile[]): PlanFile[] {
    const sortBy = vscode.workspace.getConfiguration('planManager').get<string>('sortBy', 'date')
    if (sortBy === 'name') {
      return [...plans].sort((a, b) => a.fileName.localeCompare(b.fileName))
    }
    // date: newest first
    return [...plans].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /** Re-sort, serialize, and send the full plan list to the webview. */
  refresh(): void {
    if (!this._view) return

    const plans = this._discovery.getPlans()
    const sorted = this._sortPlans(plans)
    const serialized = sorted.map((p) => this.serializePlanFile(p))

    this._view.webview.postMessage({ type: 'plansLoaded', plans: serialized })
  }

  /** Tell the webview to focus its search input. */
  focusSearch(): void {
    this._view?.webview.postMessage({ type: 'focusSearch' })
  }

  /** Tell the webview to clear its search input. */
  clearSearch(): void {
    this._view?.webview.postMessage({ type: 'clearSearch' })
  }

  /** Read planManager config and send relevant values to the webview. */
  sendConfig(): void {
    if (!this._view) return

    const config = vscode.workspace.getConfiguration('planManager')
    const sortBy = config.get<string>('sortBy', 'date')

    this._view.webview.postMessage({ type: 'configChanged', sortBy })
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private _handleMessage(msg: WebviewToHostMessage): void {
    switch (msg.type) {
      case 'ready':
        this.refresh()
        this._sendRestoreState()
        this.sendConfig()
        break

      case 'command':
        this._handleCommand(msg.command, msg.planId)
        break

      case 'searchStateChanged':
        vscode.commands.executeCommand('setContext', 'planManager.isSearchActive', msg.isActive)
        break

      case 'requestRefresh':
        this._discovery.refresh()
        break

      case 'stateChanged':
        this._debouncePersistState(msg)
        break

      case 'error':
        console.error(`Plan Manager: Webview error — ${msg.message}`, msg.context ?? '')
        break
    }
  }

  private async _handleCommand(command: string, planId: string): Promise<void> {
    const plan = this._discovery.getPlans().find((p) => p.filePath === planId)
    if (!plan) {
      this._view?.webview.postMessage({
        type: 'commandError',
        command,
        planId,
        message: `Plan not found: ${planId}`,
      })
      return
    }

    try {
      await vscode.commands.executeCommand(`planManager.${command}`, plan.filePath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Plan Manager: Command "${command}" failed for ${planId}:`, message)
      this._view?.webview.postMessage({
        type: 'commandError',
        command,
        planId,
        message,
      })
    }
  }

  // -----------------------------------------------------------------------
  // State persistence
  // -----------------------------------------------------------------------

  private _sendRestoreState(): void {
    if (!this._view) return

    const saved = this._context.workspaceState.get<PersistedWebviewState>(STATE_KEY)
    if (saved) {
      this._view.webview.postMessage({ type: 'restoreState', ...saved })
    }
  }

  private _debouncePersistState(state: PersistedWebviewState): void {
    // Keep latest pending state for flush-on-dispose
    this._pendingState = {
      collapsedGroups: state.collapsedGroups,
      scrollTop: state.scrollTop,
      focusedPlanId: state.focusedPlanId,
      searchQuery: state.searchQuery,
      splitRatio: state.splitRatio,
      paneScrollTops: state.paneScrollTops,
    }

    if (this._stateDebounceTimer !== undefined) {
      clearTimeout(this._stateDebounceTimer)
    }

    this._stateDebounceTimer = setTimeout(() => {
      this._flushState()
    }, 500)
  }

  /** Immediately persist pending state to workspaceState. */
  private _flushState(): void {
    if (this._stateDebounceTimer !== undefined) {
      clearTimeout(this._stateDebounceTimer)
      this._stateDebounceTimer = undefined
    }
    if (this._pendingState) {
      this._context.workspaceState.update(STATE_KEY, this._pendingState)
      this._pendingState = null
    }
  }

  // -----------------------------------------------------------------------
  // Disposable
  // -----------------------------------------------------------------------

  dispose(): void {
    this._flushState()
    for (const d of this._disposables) {
      d.dispose()
    }
    this._disposables = []
  }
}
