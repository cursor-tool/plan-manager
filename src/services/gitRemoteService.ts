/**
 * Git remote detection service.
 *
 * Walks up from a given path to find Git roots, reads .git/config,
 * and extracts repository information for recognized GitHub / GitLab remotes.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { GitPlatform, RepoInfo } from '../types/issue'

// ---------------------------------------------------------------------------
// Git root detection
// ---------------------------------------------------------------------------

/**
 * Walk up from `startPath` to find the nearest directory containing `.git`.
 * Returns the Git root directory, or null if none is found.
 */
export async function findGitRoot(startPath: string): Promise<string | null> {
  let current: string
  try {
    current = fs.statSync(startPath).isDirectory()
      ? startPath
      : path.dirname(startPath)
  } catch {
    return null
  }

  const root = path.parse(current).root

  while (true) {
    const gitPath = path.join(current, '.git')
    if (fs.existsSync(gitPath)) {
      return current
    }
    if (current === root) {
      return null
    }
    current = path.dirname(current)
  }
}

/**
 * Recursively scan child directories (up to `maxDepth` levels) for `.git`.
 * Stops descending into a directory once a `.git` is found there.
 */
async function scanChildGitRoots(
  dir: string,
  maxDepth: number,
  collect: (gitRoot: string) => Promise<void>,
): Promise<void> {
  if (maxDepth <= 0) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // Skip hidden dirs (except .git itself is checked below) and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const child = path.join(dir, entry.name)
    const gitPath = path.join(child, '.git')

    if (fs.existsSync(gitPath)) {
      await collect(child)
      // Don't descend further into this git repo
    } else {
      await scanChildGitRoots(child, maxDepth - 1, collect)
    }
  }
}

// ---------------------------------------------------------------------------
// Git config reading
// ---------------------------------------------------------------------------

/**
 * Read the Git config content for a repository root.
 *
 * Handles:
 * - Normal `.git/` directory → reads `.git/config`
 * - Worktree `.git` file → resolves `gitdir:` then `commondir` to reach the
 *   shared config that contains remote definitions
 * - Submodule `.git` file → falls back to `<gitdir>/config`
 */
export async function readGitConfig(gitRoot: string): Promise<string> {
  const gitPath = path.join(gitRoot, '.git')
  const stat = fs.statSync(gitPath)

  if (stat.isDirectory()) {
    return fs.readFileSync(path.join(gitPath, 'config'), 'utf-8')
  }

  // .git is a file — worktree or submodule
  const fileContent = fs.readFileSync(gitPath, 'utf-8').trim()
  const match = fileContent.match(/^gitdir:\s*(.+)$/m)
  if (!match) {
    throw new Error(`Invalid .git file at ${gitPath}`)
  }

  const gitdir = path.resolve(gitRoot, match[1].trim())

  // Worktree: .git/worktrees/<name>/commondir → points to shared .git/
  const commondirPath = path.join(gitdir, 'commondir')
  if (fs.existsSync(commondirPath)) {
    const commondir = fs.readFileSync(commondirPath, 'utf-8').trim()
    const resolvedCommon = path.resolve(gitdir, commondir)
    return fs.readFileSync(path.join(resolvedCommon, 'config'), 'utf-8')
  }

  // Submodule: gitdir itself may contain the config
  const configPath = path.join(gitdir, 'config')
  if (fs.existsSync(configPath)) {
    return fs.readFileSync(configPath, 'utf-8')
  }

  throw new Error(`Cannot find git config for: ${gitRoot}`)
}

// ---------------------------------------------------------------------------
// Git config parsing (internal)
// ---------------------------------------------------------------------------

/**
 * Parse git config text and extract `[remote "<name>"]` sections.
 * Returns `[remoteName, url][]` in definition order.
 */
function parseRemotes(configContent: string): [string, string][] {
  const remotes: [string, string][] = []
  const sectionRegex = /\[remote "([^"]+)"\]/g

  let match: RegExpExecArray | null
  while ((match = sectionRegex.exec(configContent)) !== null) {
    const remoteName = match[1]
    const sectionStart = match.index + match[0].length

    // Section body ends at the next `[` at line start, or end of string
    const nextSection = configContent.indexOf('\n[', sectionStart)
    const sectionEnd = nextSection === -1 ? configContent.length : nextSection
    const sectionBody = configContent.slice(sectionStart, sectionEnd)

    const urlMatch = sectionBody.match(/^\s*url\s*=\s*(.+)$/m)
    if (urlMatch) {
      remotes.push([remoteName, urlMatch[1].trim()])
    }
  }

  return remotes
}

// ---------------------------------------------------------------------------
// Remote URL parsing
// ---------------------------------------------------------------------------

/** SSH: git@<host>:<path> with optional trailing .git */
const SSH_REGEX = /^git@([^:]+):(.+?)(?:\.git)?$/

/** HTTPS: https://<host>/<path> with optional trailing .git */
const HTTPS_REGEX = /^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/

/** Extract hostname from a URL. Returns null on parse failure. */
function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Parse a single remote URL into a `RepoInfo`.
 *
 * Returns `null` if the URL does not match a recognized GitHub or GitLab host.
 *
 * GitHub: host must be `github.com`.
 * GitLab: host must match the hostname extracted from `gitlabBaseUrl`.
 */
export function parseRemoteUrl(
  remoteName: string,
  remoteUrl: string,
  gitlabBaseUrl: string,
): RepoInfo | null {
  let host: string
  let pathPart: string

  const sshMatch = remoteUrl.match(SSH_REGEX)
  const httpsMatch = remoteUrl.match(HTTPS_REGEX)

  if (sshMatch) {
    host = sshMatch[1]
    pathPart = sshMatch[2]
  } else if (httpsMatch) {
    host = httpsMatch[1]
    pathPart = httpsMatch[2]
  } else {
    return null
  }

  // Determine platform by matching host
  let platform: GitPlatform
  let baseUrl: string

  const hostLower = host.toLowerCase()

  if (hostLower === 'github.com') {
    platform = 'github'
    baseUrl = 'https://github.com'
  } else {
    const gitlabHost = extractHost(gitlabBaseUrl)
    if (gitlabHost && hostLower === gitlabHost) {
      platform = 'gitlab'
      baseUrl = gitlabBaseUrl.replace(/\/+$/, '')
    } else {
      return null
    }
  }

  // Split path: last segment = repo, everything before = owner
  const segments = pathPart.split('/')
  if (segments.length < 2) {
    return null
  }

  const repo = segments[segments.length - 1]
  const owner = segments.slice(0, -1).join('/')

  // Guard against empty owner or repo
  if (!owner || !repo) {
    return null
  }

  const displayName = `${owner}/${repo} (${platform})`

  return {
    platform,
    baseUrl,
    owner,
    repo,
    remoteName,
    remoteUrl,
    displayName,
  }
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

/**
 * Detect repository candidates for Issue creation.
 *
 * Priority order:
 * 1. Git root closest to `planFilePath` (walk upward)
 * 2. Git roots found in `workspaceFolders`
 *
 * Within each root, `origin` is preferred over other remotes.
 * Results are deduplicated by `platform + baseUrl + owner + repo`.
 */
export async function detectRepoCandidates(
  planFilePath: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
  gitlabBaseUrl: string,
): Promise<RepoInfo[]> {
  const candidates: RepoInfo[] = []
  const seen = new Set<string>()

  const collectFromRoot = async (gitRoot: string): Promise<void> => {
    try {
      const config = await readGitConfig(gitRoot)
      const remotes = parseRemotes(config)

      // origin first, then definition order
      remotes.sort((a, b) => {
        if (a[0] === 'origin') return -1
        if (b[0] === 'origin') return 1
        return 0
      })

      for (const [name, url] of remotes) {
        const repo = parseRemoteUrl(name, url, gitlabBaseUrl)
        if (!repo) continue

        const key = `${repo.platform}:${repo.baseUrl}:${repo.owner}:${repo.repo}`.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        candidates.push(repo)
      }
    } catch {
      // Git config unreadable — skip this root silently
    }
  }

  // 1. Plan file's own git root (highest priority)
  try {
    const planRoot = await findGitRoot(planFilePath)
    if (planRoot) {
      await collectFromRoot(planRoot)
    }
  } catch {
    // Plan file path may not exist on disk
  }

  // 2. Workspace folders — check the folder itself and shallow children (max 2 levels)
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      try {
        const wsRoot = await findGitRoot(folder.uri.fsPath)
        if (wsRoot) {
          await collectFromRoot(wsRoot)
        }
      } catch {
        // Skip unreadable workspace folders
      }

      // Scan child directories for nested git repos (depth 1-2)
      try {
        await scanChildGitRoots(folder.uri.fsPath, 2, collectFromRoot)
      } catch {
        // Skip unreadable children
      }
    }
  }

  return candidates
}
