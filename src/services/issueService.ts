/**
 * Issue service for GitHub and GitLab API integration.
 *
 * Provides `IssueProvider` implementations for creating issues,
 * listing open issues, and adding comments via platform REST APIs.
 * Uses Node.js built-in `https` module with no external dependencies.
 */

import * as https from 'https'
import { GitPlatform, RepoInfo, IssueInfo, IssueListResult, IssueProvider } from '../types/issue'

// ---------------------------------------------------------------------------
// HTTP error
// ---------------------------------------------------------------------------

/**
 * HTTP error with a `statusCode` property.
 * Satisfies the `isHttpError()` type guard in `authService.ts`
 * which checks `typeof e.statusCode === 'number'`.
 */
class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000
const USER_AGENT = 'plan-manager'

interface RequestOptions {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
}

/**
 * Perform an HTTPS JSON request and return the parsed response body.
 *
 * - Enforces a 30-second timeout (Step 3 Sec-S05).
 * - Throws `HttpError` with `statusCode` on non-2xx responses.
 * - Never includes raw response bodies or tokens in error messages.
 */
function requestJson<T>(options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const parsed = new URL(options.url)
    let settled = false

    const settle = <V>(fn: (v: V) => void, value: V): void => {
      if (settled) return
      settled = true
      fn(value)
    }

    // Build final headers: merge caller headers with common defaults
    const finalHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...options.headers,
    }
    if (options.body) {
      finalHeaders['Content-Type'] = 'application/json'
      finalHeaders['Content-Length'] = String(Buffer.byteLength(options.body, 'utf-8'))
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: finalHeaders,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0
          const raw = Buffer.concat(chunks).toString('utf-8')

          if (statusCode >= 200 && statusCode < 300) {
            try {
              settle(resolve, JSON.parse(raw) as T)
            } catch {
              settle(reject, new HttpError('Invalid JSON in response', statusCode))
            }
            return
          }

          const message = buildErrorMessage(statusCode)
          settle(reject, new HttpError(message, statusCode))
        })
      },
    )

    req.on('timeout', () => {
      req.destroy()
      settle(reject, new HttpError('Request timed out', 0))
    })

    req.on('error', () => {
      settle(reject, new HttpError('Network error: connection failed', 0))
    })

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

/** Map HTTP status codes to human-readable error messages. */
function buildErrorMessage(statusCode: number): string {
  switch (statusCode) {
    case 401:
      return 'Authentication failed: token is invalid or expired'
    case 403:
      return 'Permission denied: insufficient token scope or Issues feature is disabled'
    case 404:
      return 'Not found: repository or issue does not exist'
    case 422:
      return 'Validation error: the request content was rejected by the server'
    default:
      if (statusCode >= 500) {
        return `Server error (${statusCode})`
      }
      return `Request failed with status ${statusCode}`
  }
}

// ---------------------------------------------------------------------------
// Pagination constant
// ---------------------------------------------------------------------------

const PER_PAGE = 100

// ---------------------------------------------------------------------------
// GitHub provider
// ---------------------------------------------------------------------------

/** GitHub REST API v3 base URL */
const GITHUB_API = 'https://api.github.com'

function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
  }
}

/** Encode owner and repo for GitHub API path segments. */
function githubRepoPath(repo: RepoInfo): string {
  return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
}

/** GitHub API response for an issue (subset of fields we use) */
interface GitHubIssueResponse {
  number: number
  title: string
  html_url: string
  pull_request?: unknown
}

/** GitHub API response for a comment (subset) */
interface GitHubCommentResponse {
  html_url: string
}

export const githubProvider: IssueProvider = {
  platform: 'github',

  async validateToken(repo: RepoInfo, token: string): Promise<void> {
    await requestJson<unknown>({
      method: 'GET',
      url: `${GITHUB_API}/repos/${githubRepoPath(repo)}`,
      headers: githubHeaders(token),
    })
  },

  async createIssue(repo: RepoInfo, title: string, body: string, token: string): Promise<IssueInfo> {
    const data = await requestJson<GitHubIssueResponse>({
      method: 'POST',
      url: `${GITHUB_API}/repos/${githubRepoPath(repo)}/issues`,
      headers: githubHeaders(token),
      body: JSON.stringify({ title, body }),
    })

    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
    }
  },

  async listOpenIssues(repo: RepoInfo, token: string): Promise<IssueListResult> {
    const data = await requestJson<GitHubIssueResponse[]>({
      method: 'GET',
      url: `${GITHUB_API}/repos/${githubRepoPath(repo)}/issues?state=open&per_page=${PER_PAGE}&sort=updated&direction=desc`,
      headers: githubHeaders(token),
    })

    // Guard: if the API unexpectedly returns a non-array, treat as empty
    if (!Array.isArray(data)) {
      return { issues: [], truncated: false }
    }

    // GitHub /issues endpoint returns PRs as well — filter them out.
    // `truncated` uses pre-filter count intentionally: it reflects whether
    // the server had more items beyond per_page, not the filtered result count.
    const issues: IssueInfo[] = data
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: item.number,
        title: item.title,
        url: item.html_url,
      }))

    return {
      issues,
      truncated: data.length >= PER_PAGE,
    }
  },

  async addComment(repo: RepoInfo, issueNumber: number, body: string, token: string): Promise<IssueInfo> {
    const data = await requestJson<GitHubCommentResponse>({
      method: 'POST',
      url: `${GITHUB_API}/repos/${githubRepoPath(repo)}/issues/${issueNumber}/comments`,
      headers: githubHeaders(token),
      body: JSON.stringify({ body }),
    })

    // Comment URL points to the specific comment anchor.
    // Title is empty — the caller (extension.ts) already holds the issue title.
    return {
      number: issueNumber,
      title: '',
      url: data.html_url,
    }
  },
}

// ---------------------------------------------------------------------------
// GitLab provider
// ---------------------------------------------------------------------------

function gitlabHeaders(token: string): Record<string, string> {
  return {
    'Private-Token': token,
  }
}

/** Encode `owner/repo` (or `group/subgroup/repo`) for GitLab project ID in URL path. */
function encodedProject(repo: RepoInfo): string {
  return encodeURIComponent(`${repo.owner}/${repo.repo}`)
}

/** Build browser URL for a GitLab issue. */
function gitlabIssueUrl(repo: RepoInfo, issueNumber: number): string {
  return `${repo.baseUrl}/${repo.owner}/${repo.repo}/-/issues/${issueNumber}`
}

/** GitLab API response for an issue (subset of fields we use) */
interface GitLabIssueResponse {
  iid: number
  title: string
  web_url: string
}

export const gitlabProvider: IssueProvider = {
  platform: 'gitlab',

  async validateToken(repo: RepoInfo, token: string): Promise<void> {
    await requestJson<unknown>({
      method: 'GET',
      url: `${repo.baseUrl}/api/v4/projects/${encodedProject(repo)}`,
      headers: gitlabHeaders(token),
    })
  },

  async createIssue(repo: RepoInfo, title: string, body: string, token: string): Promise<IssueInfo> {
    const data = await requestJson<GitLabIssueResponse>({
      method: 'POST',
      url: `${repo.baseUrl}/api/v4/projects/${encodedProject(repo)}/issues`,
      headers: gitlabHeaders(token),
      body: JSON.stringify({ title, description: body }),
    })

    return {
      number: data.iid,
      title: data.title,
      url: data.web_url,
    }
  },

  async listOpenIssues(repo: RepoInfo, token: string): Promise<IssueListResult> {
    const data = await requestJson<GitLabIssueResponse[]>({
      method: 'GET',
      url: `${repo.baseUrl}/api/v4/projects/${encodedProject(repo)}/issues?state=opened&per_page=${PER_PAGE}&order_by=updated_at&sort=desc`,
      headers: gitlabHeaders(token),
    })

    // Guard: if the API unexpectedly returns a non-array, treat as empty
    if (!Array.isArray(data)) {
      return { issues: [], truncated: false }
    }

    const issues: IssueInfo[] = data.map((item) => ({
      number: item.iid,
      title: item.title,
      url: item.web_url,
    }))

    return {
      issues,
      truncated: data.length >= PER_PAGE,
    }
  },

  async addComment(repo: RepoInfo, issueNumber: number, body: string, token: string): Promise<IssueInfo> {
    // GitLab Notes API does not return parent issue data.
    // Response is intentionally discarded.
    await requestJson<unknown>({
      method: 'POST',
      url: `${repo.baseUrl}/api/v4/projects/${encodedProject(repo)}/issues/${issueNumber}/notes`,
      headers: gitlabHeaders(token),
      body: JSON.stringify({ body }),
    })

    // Construct IssueInfo from known context. Title is empty because
    // the caller (extension.ts) already holds the selected issue title.
    return {
      number: issueNumber,
      title: '',
      url: gitlabIssueUrl(repo, issueNumber),
    }
  },
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

const providers: Record<GitPlatform, IssueProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
}

/**
 * Get the appropriate `IssueProvider` for a platform.
 * Called by `extension.ts` after repository detection determines the platform.
 */
export function getIssueProvider(platform: GitPlatform): IssueProvider {
  return providers[platform]
}
