import * as vscode from 'vscode'
import { PlanDiscoveryService } from './services/planDiscoveryService'
import { PlanWebviewViewProvider } from './services/webviewViewProvider'
import { convertClaudeToCursor, convertCursorToClaude } from './services/conversionService'
import { PlanFile, PlanSource } from './types/plan'
import { toForwardSlash } from './utils/pathUtils'

// Environment detection
const isCursor = vscode.env.uriScheme === 'cursor'
const isClaudeInstalled = vscode.extensions.getExtension('anthropic.claude-code') !== undefined

// Locale detection
type Locale = 'en' | 'ja'
function getLocale(): Locale {
  return vscode.env.language === 'ja' ? 'ja' : 'en'
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('Plan Manager: activating...')

  // --- Phase A: Service initialization ---
  const discovery = new PlanDiscoveryService()
  discovery.initialize()

  const webviewProvider = new PlanWebviewViewProvider(context, discovery)
  const registration = vscode.window.registerWebviewViewProvider('planManagerView', webviewProvider, {
    webviewOptions: { retainContextWhenHidden: false },
  })

  context.subscriptions.push(discovery, registration)

  // Wire discovery changes to webview
  context.subscriptions.push(
    discovery.onDidChangePlans(() => webviewProvider.refresh()),
  )

  // --- Helper ---
  function resolvePlan(planIdOrItem: string | any): PlanFile | undefined {
    if (!planIdOrItem) return undefined
    if (typeof planIdOrItem === 'string') return discovery.getPlans().find(p => p.filePath === planIdOrItem)
    return planIdOrItem?.plan
  }

  // --- Phase B: Command registration ---

  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.refreshPlans', () => {
      discovery.refresh()
      vscode.window.showInformationMessage('Plan Manager: Refreshed')
    }),
  )

  // Search (WebviewView filtering)
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.search', () => {
      webviewProvider.focusSearch()
    }),
  )

  // Clear search
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.clearSearch', () => {
      webviewProvider.clearSearch()
    }),
  )

  // Open in editor
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInEditor', (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const uri = vscode.Uri.file(plan.filePath)
      vscode.window.showTextDocument(uri)
    }),
  )

  // Open in preview (markdown preview)
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInPreview', (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const uri = vscode.Uri.file(plan.filePath)
      vscode.commands.executeCommand('markdown.showPreview', uri)
    }),
  )

  // Open in editor (pinned — double-click: always open as persistent tab, not preview)
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInEditorPinned', (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const uri = vscode.Uri.file(plan.filePath)
      vscode.window.showTextDocument(uri, { preview: false })
    }),
  )

  // Open in Cursor (Deep Link)
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInCursor', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const prompt = buildCursorPrompt(plan)
      const encoded = encodeURIComponent(prompt)
      const uri = vscode.Uri.parse(`cursor://anysphere.cursor-deeplink/prompt?text=${encoded}`)
      await vscode.env.openExternal(uri)
      // Always copy to clipboard as backup (openExternal always returns true)
      await vscode.env.clipboard.writeText(prompt)
      vscode.window.showInformationMessage('Prompt sent via Deep Link. Also copied to clipboard.')
    }),
  )

  // Open in Cursor Agent (terminal)
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInCursorAgent', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const terminal = vscode.window.createTerminal('Cursor Agent Plan')
      terminal.show()
      await waitForShellReady(terminal)
      const ws = toForwardSlash(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '')
      const prompt = buildCursorPrompt(plan)
      terminal.sendText(
        `agent --plan --workspace "${ws}" "${shellEscape(prompt)}"`,
      )
    }),
  )

  // Open in Claude
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInClaude', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const prompt = buildClaudePrompt(plan)
      if (isClaudeInstalled) {
        await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, prompt)
        return
      }

      // Fallback: terminal CLI
      const terminal = vscode.window.createTerminal('Claude Code Plan')
      terminal.show()
      await waitForShellReady(terminal)
      terminal.sendText(`claude --permission-mode plan "${shellEscape(prompt)}"`)

    }),
  )

  // Copy path
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.copyPath', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      await vscode.env.clipboard.writeText(plan.filePath)
      vscode.window.showInformationMessage(`Copied: ${plan.filePath}`)
    }),
  )

  // Convert Claude → Cursor
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.convertToCursor', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const result = convertClaudeToCursor(plan)
      const doc = await vscode.workspace.openTextDocument({ content: result, language: 'markdown' })
      vscode.window.showTextDocument(doc)
    }),
  )

  // Convert Cursor → Claude
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.convertToClaude', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const result = convertCursorToClaude(plan)
      const doc = await vscode.workspace.openTextDocument({ content: result, language: 'markdown' })
      vscode.window.showTextDocument(doc)
    }),
  )

  // Reveal in OS file manager
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.revealInOS', (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(plan.filePath))
    }),
  )

  // --- Phase C: Configuration change listener ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('planManager.sortBy')) {
        webviewProvider.sendConfig()
        webviewProvider.refresh()
      }
      if (
        e.affectsConfiguration('planManager.autoRefreshEnabled') ||
        e.affectsConfiguration('planManager.autoRefreshIntervalSeconds')
      ) {
        discovery.restartPolling()
      }
      if (
        e.affectsConfiguration('planManager.claudePlansPath') ||
        e.affectsConfiguration('planManager.cursorPlansPath') ||
        e.affectsConfiguration('planManager.additionalScanPaths')
      ) {
        discovery.refresh()
      }
    }),
  )

  console.log(`Plan Manager: activated (isCursor=${isCursor}, claudeInstalled=${isClaudeInstalled})`)
}

export function deactivate(): void {
  console.log('Plan Manager: deactivated')
}

// --- Helpers ---

function getPlanDir(key: 'cursorPlansPath' | 'claudePlansPath'): string {
  return vscode.workspace.getConfiguration('planManager').get<string>(key, key === 'cursorPlansPath' ? '~/.cursor/plans' : '~/.claude/plans')
}

function buildCursorPrompt(plan: PlanFile): string {
  const locale = getLocale()
  const filePath = plan.filePath
  const fileName = plan.fileName.replace(/\.plan\.md$/, '').replace(/\.md$/, '')
  const cursorDir = getPlanDir('cursorPlansPath')
  const isConvert = plan.source === PlanSource.ClaudeCode

  if (isConvert) {
    return locale === 'ja'
      ? [
          '[プラン変換]',
          `ファイル: ${filePath}`,
          '',
          'このファイルはClaude Codeプラン（プレーンMarkdown）です。',
          'Cursor形式に変換してください。',
          '',
          'ステップ1 - 読み取りと検証:',
          '- 上記パスのMarkdownプランを読み取ってください',
          '- プランの内容を確認し、以下の不完全な点がないかチェックしてください:',
          '  ・タスクの目的や手順が曖昧または欠落している',
          '  ・前提条件や依存関係が明記されていない',
          '  ・完了条件が不明確なタスクがある',
          '  ・矛盾する記述がある',
          '- 不完全な点を発見した場合は、変換を進める前にユーザーに質問してください',
          '',
          'ステップ2 - 変換:',
          `- ${cursorDir}/${fileName}.plan.md に新しいファイルを作成してください`,
          '- YAMLフロントマター（name, overview, todos）を追加してください',
          '  （見出し/チェックボックスから抽出）',
          '- フロントマターの下にオリジナルのMarkdown本文を残してください',
          '',
          'ステップ3 - 実行:',
          '- 新しく作成したプランの最初の未完了タスクから開始してください',
          '- 各タスク完了時にtodosのstatusを更新してください',
          '',
          '重要:',
          '- 元のファイルをそのまま実行しないでください',
          '- まずYAMLフロントマター付きの正しいCursorプラン形式に変換してください',
          '- 不明点がある場合は推測せず、必ずユーザーに確認してください',
        ].join('\n')
      : [
          '[Plan Conversion]',
          `File: ${filePath}`,
          '',
          'This file is a Claude Code plan (plain markdown).',
          'Convert it to Cursor format.',
          '',
          'Step 1 - Read & Validate:',
          '- Read the markdown plan at the path above',
          '- Review the plan content and check for any incomplete aspects:',
          '  - Tasks with ambiguous or missing objectives/steps',
          '  - Unstated prerequisites or dependencies',
          '  - Tasks with unclear completion criteria',
          '  - Contradictory descriptions',
          '- If you find incomplete aspects, ask the user before proceeding with conversion',
          '',
          'Step 2 - Convert:',
          `- Create a new file at ${cursorDir}/${fileName}.plan.md`,
          '- Add YAML frontmatter (name, overview, todos) extracted from headings/checkboxes',
          '- Keep the original markdown body below the frontmatter',
          '',
          'Step 3 - Execute:',
          '- Start from the first pending todo in the newly created plan',
          '- Update todo statuses as you complete each task',
          '',
          'Important:',
          '- Do NOT execute the original file as-is',
          '- First convert it to proper Cursor plan format with YAML frontmatter',
          '- If anything is unclear, ask the user instead of guessing',
        ].join('\n')
  }

  // Continue mode (Cursor → Cursor)
  return locale === 'ja'
    ? [
        '[プラン実行]',
        `ファイル: ${filePath}`,
        '',
        '既存のCursorプランを再開します。',
        '上記ファイルを読み取り、YAMLフロントマターの最初の未完了タスクから実行を続けてください。',
        '',
        '指示:',
        '- プランの書き換えや再構成は行わないでください',
        '- status が "pending" の最初のタスクを見つけて作業を開始してください',
        '- 各タスクの status を "in_progress" → "completed" と更新してください',
        '- 各タスクのプランの記述に従って作業してください',
      ].join('\n')
    : [
        '[Plan Execution]',
        `File: ${filePath}`,
        '',
        'Resume the existing Cursor plan.',
        'Read the file above and continue from the first pending todo in the YAML frontmatter.',
        '',
        'Instructions:',
        '- Do NOT rewrite or restructure the plan',
        '- Find the first todo with status "pending" and begin working on it',
        '- Update each todo\'s status to "in_progress" then "completed" as you go',
        '- Follow the plan\'s guidance for each task',
      ].join('\n')
}

function buildClaudePrompt(plan: PlanFile): string {
  const locale = getLocale()
  const filePath = plan.filePath
  const fileName = plan.fileName.replace(/\.plan\.md$/, '').replace(/\.md$/, '')
  const claudeDir = getPlanDir('claudePlansPath')
  const isConvert = plan.source === PlanSource.Cursor

  if (isConvert) {
    return locale === 'ja'
      ? [
          '[プラン変換]',
          `ファイル: ${filePath}`,
          '',
          'このファイルはCursorプラン（YAMLフロントマター形式）です。',
          'Claude Code形式に変換してください。',
          '',
          'ステップ1 - 読み取りと検証:',
          '- 上記パスのプランファイルを読み取ってください',
          '- プランの内容を確認し、以下の不完全な点がないかチェックしてください:',
          '  ・タスクの目的や手順が曖昧または欠落している',
          '  ・前提条件や依存関係が明記されていない',
          '  ・完了条件が不明確なタスクがある',
          '  ・矛盾する記述がある',
          '- 不完全な点を発見した場合は、変換を進める前にユーザーに質問してください',
          '',
          'ステップ2 - 変換:',
          `- ${claudeDir}/${fileName}.md に新しいファイルを作成してください`,
          '- YAMLフロントマターを削除してください',
          '- todosをMarkdownチェックボックスに変換してください',
          '  （pending → - [ ]、completed → - [x]）',
          '- フロントマターの "name" からH1タイトルを追加してください',
          '- フロントマターの "overview" から "## 概要" セクションを追加してください',
          '- オリジナルのMarkdown本文を残してください',
          '',
          'ステップ3 - 実行:',
          '- 新しく作成したプランの最初の未チェックタスクから開始してください',
          '- 各タスク完了時にチェックを入れてください',
          '',
          '重要:',
          '- 元のファイルをそのまま実行しないでください',
          '- まずClaude Codeに適したプレーンMarkdown形式に変換してください',
          '- 不明点がある場合は推測せず、必ずユーザーに確認してください',
        ].join('\n')
      : [
          '[Plan Conversion]',
          `File: ${filePath}`,
          '',
          'This file is a Cursor plan (YAML frontmatter format).',
          'Convert it to Claude Code format.',
          '',
          'Step 1 - Read & Validate:',
          '- Read the plan file at the path above',
          '- Review the plan content and check for any incomplete aspects:',
          '  - Tasks with ambiguous or missing objectives/steps',
          '  - Unstated prerequisites or dependencies',
          '  - Tasks with unclear completion criteria',
          '  - Contradictory descriptions',
          '- If you find incomplete aspects, ask the user before proceeding with conversion',
          '',
          'Step 2 - Convert:',
          `- Create a new file at ${claudeDir}/${fileName}.md`,
          '- Remove YAML frontmatter',
          '- Convert todos to markdown checkboxes (pending → - [ ], completed → - [x])',
          '- Add H1 title from the frontmatter "name" field',
          '- Add "## Overview" section from the frontmatter "overview" field',
          '- Keep the original markdown body',
          '',
          'Step 3 - Execute:',
          '- Start from the first unchecked task in the newly created plan',
          '- Check off tasks as you complete them',
          '',
          'Important:',
          '- Do NOT execute the original file as-is',
          '- First convert it to plain markdown format suitable for Claude Code',
          '- If anything is unclear, ask the user instead of guessing',
        ].join('\n')
  }

  // Continue mode (Claude → Claude)
  return locale === 'ja'
    ? [
        '[プラン実行]',
        `ファイル: ${filePath}`,
        '',
        '既存のClaude Codeプランを再開します。',
        '上記ファイルを読み取り、プランに記載されたタスクの実行を続けてください。',
        '',
        '指示:',
        '- プランの書き換えや再構成は行わないでください',
        '- 最初の未完了タスクを見つけて作業を開始してください',
        '- 完了したタスクにはチェックを入れてください',
        '- プランの構成と指示に従ってください',
      ].join('\n')
    : [
        '[Plan Execution]',
        `File: ${filePath}`,
        '',
        'Resume the existing Claude Code plan.',
        'Read the file above and continue executing the tasks listed in the plan.',
        '',
        'Instructions:',
        '- Do NOT rewrite or restructure the plan',
        '- Find the first incomplete task and begin working',
        '- Check off tasks as you complete them',
        '- Follow the plan\'s structure and guidance',
      ].join('\n')
}

function shellEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
}

function waitForShellReady(terminal: vscode.Terminal): Promise<void> {
  return new Promise((resolve) => {
    const disposable = (vscode.window as any).onDidChangeTerminalShellIntegration?.((e: any) => {
      if (e.terminal === terminal) {
        disposable.dispose()
        resolve()
      }
    })
    // Fallback timeout for environments without shell integration
    setTimeout(() => {
      disposable?.dispose()
      resolve()
    }, 2000)
  })
}
