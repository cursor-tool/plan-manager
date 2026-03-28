import * as vscode from 'vscode'
import { PlanDiscoveryService } from './services/planDiscoveryService'
import { PlanWebviewViewProvider } from './services/webviewViewProvider'
import { convertClaudeToCursor, convertCursorToClaude } from './services/conversionService'
import { PlanFile, PlanSource } from './types/plan'

// Environment detection
const isCursor = vscode.env.uriScheme === 'cursor'
const isClaudeInstalled = vscode.extensions.getExtension('anthropic.claude-code') !== undefined

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
      const config = vscode.workspace.getConfiguration('planManager')
      const action = config.get<string>('defaultClickAction', 'preview')
      const uri = vscode.Uri.file(plan.filePath)
      if (action === 'preview') {
        vscode.commands.executeCommand('markdown.showPreview', uri)
      } else {
        vscode.window.showTextDocument(uri)
      }
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
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      terminal.sendText(
        `agent --plan --workspace "${ws}" "Read and execute the plan at ${plan.filePath}. Follow the todos in the YAML frontmatter."`,
      )
    }),
  )

  // Open in Claude
  context.subscriptions.push(
    vscode.commands.registerCommand('planManager.openInClaude', async (planIdOrItem: string | any) => {
      const plan = resolvePlan(planIdOrItem)
      if (!plan) return
      const prompt = `Read and continue the plan at ${plan.filePath}. Follow all tasks listed in the plan.`

      if (isClaudeInstalled) {
        await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, prompt)
        return
      }

      // Fallback: terminal CLI
      const terminal = vscode.window.createTerminal('Claude Code Plan')
      terminal.show()
      await waitForShellReady(terminal)
      terminal.sendText(`claude --permission-mode plan "${prompt}"`)
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
      if (e.affectsConfiguration('planManager.sortBy') || e.affectsConfiguration('planManager.defaultClickAction')) {
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

function buildCursorPrompt(plan: PlanFile): string {
  return `Read and execute the plan at ${plan.filePath}\nFollow the todos in the YAML frontmatter. Start from the first pending task.`
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
