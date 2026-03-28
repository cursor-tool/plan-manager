import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { PlanFile, PlanSource } from '../types/plan'
import { parseFrontmatter } from '../utils/frontmatterParser'
import { extractH1 } from '../utils/markdownParser'
import { expandHome, getClaudePlansDir, getCursorPlansDir } from '../utils/pathUtils'

export class PlanDiscoveryService implements vscode.Disposable {
  private _plans: PlanFile[] = []
  private _watchers: vscode.FileSystemWatcher[] = []
  private _pollTimer: ReturnType<typeof setInterval> | undefined
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined

  private readonly _onDidChangePlans = new vscode.EventEmitter<void>()
  readonly onDidChangePlans = this._onDidChangePlans.event

  initialize(): void {
    this._scanAll()
    this._setupWatchers()
    this._setupPolling()
  }

  getPlans(): PlanFile[] {
    return this._plans
  }

  refresh(): void {
    this._scanAll()
    this._onDidChangePlans.fire()
  }

  private _scanAll(): void {
    const config = vscode.workspace.getConfiguration('planManager')
    const claudeDir = expandHome(config.get<string>('claudePlansPath', '~/.claude/plans'))
    const cursorDir = expandHome(config.get<string>('cursorPlansPath', '~/.cursor/plans'))
    const additionalPaths = config.get<string[]>('additionalScanPaths', [])

    const plans: PlanFile[] = []

    plans.push(...this._scanDirectory(claudeDir, PlanSource.ClaudeCode, '*.md'))
    plans.push(...this._scanDirectory(cursorDir, PlanSource.Cursor, '*.plan.md'))

    for (const p of additionalPaths) {
      const expanded = expandHome(p)
      plans.push(...this._scanDirectory(expanded, PlanSource.ClaudeCode, '*.md'))
      plans.push(...this._scanDirectory(expanded, PlanSource.Cursor, '*.plan.md'))
    }

    this._plans = plans
  }

  private _scanDirectory(dirPath: string, source: PlanSource, globPattern: string): PlanFile[] {
    if (!fs.existsSync(dirPath)) return []

    const extension = source === PlanSource.Cursor ? '.plan.md' : '.md'
    const files = fs.readdirSync(dirPath).filter((f) => {
      if (source === PlanSource.Cursor) return f.endsWith('.plan.md')
      // For Claude, accept .md but exclude .plan.md
      return f.endsWith('.md') && !f.endsWith('.plan.md')
    })

    return files.map((fileName) => {
      const filePath = path.join(dirPath, fileName)
      const stat = fs.statSync(filePath)
      const content = fs.readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter(content)

      let name: string
      if (frontmatter?.name) {
        name = frontmatter.name
      } else {
        name = extractH1(content) ?? fileName.replace(/\.plan\.md$|\.md$/, '')
      }

      return {
        filePath,
        fileName,
        source,
        name,
        createdAt: stat.birthtime,
        modifiedAt: stat.mtime,
        size: stat.size,
        frontmatter,
        markdownBody: body,
      }
    })
  }

  /**
   * FileSystemWatcher setup.
   * MUST use RelativePattern for files outside workspace.
   * onDidDelete does NOT fire outside workspace — polling compensates.
   */
  private _setupWatchers(): void {
    const claudeDir = getClaudePlansDir()
    const cursorDir = getCursorPlansDir()

    for (const dir of [claudeDir, cursorDir]) {
      if (!fs.existsSync(dir)) continue

      const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '*.md')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)

      const debouncedRefresh = () => {
        if (this._debounceTimer) clearTimeout(this._debounceTimer)
        this._debounceTimer = setTimeout(() => {
          this._scanAll()
          this._onDidChangePlans.fire()
        }, 300)
      }

      watcher.onDidCreate(debouncedRefresh)
      watcher.onDidChange(debouncedRefresh)
      // onDidDelete may not fire outside workspace — polling handles this

      this._watchers.push(watcher)
    }
  }

  /** Periodic polling to detect file deletions (onDidDelete limitation workaround) */
  private _setupPolling(): void {
    const config = vscode.workspace.getConfiguration('planManager')
    if (!config.get<boolean>('autoRefreshEnabled', true)) return

    const intervalMs = config.get<number>('autoRefreshIntervalSeconds', 30) * 1000
    this._pollTimer = setInterval(() => {
      const oldCount = this._plans.length
      this._scanAll()
      if (this._plans.length !== oldCount) {
        this._onDidChangePlans.fire()
      }
    }, intervalMs)
  }

  restartPolling(): void {
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._setupPolling()
  }

  dispose(): void {
    if (this._pollTimer) clearInterval(this._pollTimer)
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    for (const w of this._watchers) w.dispose()
    this._onDidChangePlans.dispose()
  }
}
