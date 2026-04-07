/**
 * Shared type definitions for Git issue tracker integration.
 *
 * Used by gitRemoteService, authService, issueService, and extension.ts
 * to provide a common contract across GitHub and GitLab platforms.
 */

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export type GitPlatform = 'github' | 'gitlab'

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface RepoInfo {
  /** Git hosting platform */
  platform: GitPlatform
  /** Base URL of the platform, without trailing slash (e.g. "https://github.com") */
  baseUrl: string
  /** Repository owner or GitLab group path. May contain `/` for nested groups (e.g. "group/subgroup") */
  owner: string
  /** Repository name */
  repo: string
  /** Git remote name (e.g. "origin") */
  remoteName: string
  /** Original remote URL from .git/config */
  remoteUrl: string
  /** Pre-computed label for QuickPick display (e.g. "owner/repo (github)") */
  displayName: string
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface IssueInfo {
  /** GitHub issue number or GitLab project-scoped iid. Do NOT use GitLab's global `id`. */
  number: number
  /** Issue title */
  title: string
  /** Browser-accessible URL (GitHub html_url / GitLab web_url) */
  url: string
}

export interface IssueListResult {
  /** List of open issues, up to per_page limit */
  issues: IssueInfo[]
  /** true if the server has more issues than the per_page limit (100) */
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface IssueProvider {
  /** Platform this provider handles */
  platform: GitPlatform

  /** Validate that the token has sufficient access to the repository. Throws on failure. */
  validateToken(repo: RepoInfo, token: string): Promise<void>

  /** Create a new issue and return its info */
  createIssue(repo: RepoInfo, title: string, body: string, token: string): Promise<IssueInfo>

  /** Fetch open issues sorted by recently updated, up to 100 */
  listOpenIssues(repo: RepoInfo, token: string): Promise<IssueListResult>

  /**
   * Add a comment to an existing issue and return the issue info for navigation.
   * Note: GitLab Notes API does not return parent issue data. Implementations
   * should construct the return value from the issueNumber and repo context
   * (e.g. build the URL from baseUrl, owner, repo, and issueNumber).
   */
  addComment(repo: RepoInfo, issueNumber: number, body: string, token: string): Promise<IssueInfo>
}
