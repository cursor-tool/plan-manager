/**
 * Authentication service for Git platform token management.
 *
 * Handles SecretStorage read/write, interactive token input,
 * and the validate-retry flow for GitHub / GitLab PATs.
 */

import * as vscode from 'vscode'
import { GitPlatform, RepoInfo, IssueProvider } from '../types/issue'
import { PlanManagerError } from '../errors/planManagerError'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SecretStorage key prefix. Produces "planManager.githubPat" / "planManager.gitlabPat" */
const SECRET_KEY_PREFIX = 'planManager.'
const SECRET_KEY_SUFFIX = 'Pat'

function secretKey(platform: GitPlatform): string {
  return `${SECRET_KEY_PREFIX}${platform}${SECRET_KEY_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Check whether an unknown error carries an HTTP `statusCode` property. */
function isHttpError(e: unknown): e is { statusCode: number; message?: string } {
  return typeof e === 'object' && e !== null && typeof (e as any).statusCode === 'number'
}

// ---------------------------------------------------------------------------
// Locale helpers
// ---------------------------------------------------------------------------

type Locale = 'en' | 'ja'

function getLocale(): Locale {
  return vscode.env.language === 'ja' ? 'ja' : 'en'
}

const i18n = {
  promptMessage: {
    en: (platform: string) => `Enter Personal Access Token for ${platform}`,
    ja: (platform: string) => `${platform} の Personal Access Token を入力`,
  },
  promptPlaceholder: {
    en: (platform: string) => `Paste your ${platform} PAT here`,
    ja: (platform: string) => `${platform} の PAT を貼り付けてください`,
  },
  tokenExpired: {
    en: (platform: string) => `${platform} token is invalid or expired. Please enter a new one.`,
    ja: (platform: string) => `${platform} のトークンが無効または期限切れです。再入力してください。`,
  },
  validationFailed: {
    en: (platform: string) => `${platform} token validation failed after retry.`,
    ja: (platform: string) => `${platform} トークンの検証がリトライ後も失敗しました。`,
  },
  gitlabUrlInvalid: {
    en: (url: string) => `GitLab Base URL must use HTTPS. Got: "${url}"`,
    ja: (url: string) => `GitLab Base URL は HTTPS である必要があります。入力値: "${url}"`,
  },
} as const

// ---------------------------------------------------------------------------
// Token CRUD
// ---------------------------------------------------------------------------

/** Retrieve a stored PAT from SecretStorage. Returns `undefined` if not set. */
export async function getToken(
  secrets: vscode.SecretStorage,
  platform: GitPlatform,
): Promise<string | undefined> {
  return secrets.get(secretKey(platform))
}

/** Store a PAT in SecretStorage. */
export async function setToken(
  secrets: vscode.SecretStorage,
  platform: GitPlatform,
  token: string,
): Promise<void> {
  await secrets.store(secretKey(platform), token)
}

/** Delete a stored PAT from SecretStorage. */
export async function deleteToken(
  secrets: vscode.SecretStorage,
  platform: GitPlatform,
): Promise<void> {
  await secrets.delete(secretKey(platform))
}

// ---------------------------------------------------------------------------
// Interactive input
// ---------------------------------------------------------------------------

/**
 * Show a password input box for the user to enter a PAT.
 * Returns the entered token (trimmed), or `undefined` if cancelled.
 */
export async function promptForToken(
  platform: GitPlatform,
): Promise<string | undefined> {
  const locale = getLocale()
  const platformLabel = platform === 'github' ? 'GitHub' : 'GitLab'

  const token = await vscode.window.showInputBox({
    prompt: i18n.promptMessage[locale](platformLabel),
    placeHolder: i18n.promptPlaceholder[locale](platformLabel),
    password: true,
    ignoreFocusOut: true,
  })

  // Treat empty / whitespace-only input as cancellation.
  // .trim() strips accidental whitespace from pasted PATs.
  if (!token || token.trim() === '') {
    return undefined
  }

  return token.trim()
}

// ---------------------------------------------------------------------------
// Validation flow
// ---------------------------------------------------------------------------

/**
 * Ensure the user has a valid token for the given repo and provider.
 *
 * Flow:
 * 1. Try the stored token
 * 2. If none, prompt
 * 3. Validate via `provider.validateToken()`
 * 4. On 401 → delete stored token, prompt once more
 * 5. On second failure → throw
 * 6. On cancel at any prompt → return `undefined` (silent exit)
 *
 * The validated token is saved to SecretStorage before returning.
 */
export async function ensureValidToken(
  secrets: vscode.SecretStorage,
  repo: RepoInfo,
  provider: IssueProvider,
): Promise<string | undefined> {
  const { platform } = repo
  const locale = getLocale()
  const platformLabel = platform === 'github' ? 'GitHub' : 'GitLab'

  // --- Attempt 1: stored or freshly entered token ---
  let token = await getToken(secrets, platform)

  if (!token) {
    token = await promptForToken(platform)
    if (!token) {
      return undefined // user cancelled
    }
  }

  try {
    await provider.validateToken(repo, token)
    await setToken(secrets, platform, token)
    return token
  } catch (error: unknown) {
    if (!isHttpError(error) || error.statusCode !== 401) {
      // 403, 404, network errors etc. — propagate without deleting token
      throw error
    }

    // --- Attempt 2: 401 means token is invalid/expired ---
    await deleteToken(secrets, platform)

    // Fire-and-forget: notification appears while the next prompt opens
    vscode.window.showWarningMessage(i18n.tokenExpired[locale](platformLabel))

    const retryToken = await promptForToken(platform)
    if (!retryToken) {
      return undefined // user cancelled retry
    }

    try {
      await provider.validateToken(repo, retryToken)
      await setToken(secrets, platform, retryToken)
      return retryToken
    } catch (retryError: unknown) {
      // Wrap with sanitized cause — only message and statusCode, no raw HTTP response
      const sanitizedCause = isHttpError(retryError)
        ? { statusCode: retryError.statusCode, message: retryError.message }
        : retryError instanceof Error
          ? { message: retryError.message }
          : undefined
      throw new PlanManagerError(i18n.validationFailed[locale](platformLabel), 'AUTH_INVALID', sanitizedCause)
    }
  }
}

// ---------------------------------------------------------------------------
// GitLab base URL validation
// ---------------------------------------------------------------------------

/**
 * Validate that a GitLab base URL uses HTTPS and is a well-formed URL.
 * Returns the normalized URL (trailing slash removed).
 * Throws if the URL is invalid or does not use `https:` protocol.
 */
export function validateGitLabBaseUrl(url: string): string {
  const trimmed = url.trim()
  // Truncate for safe error messages (Sec-S01: prevent control character injection in logs)
  const safeUrl = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed

  // Full URL parse catches malformed variants (e.g. "https:// ", unicode lookalikes)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    const locale = getLocale()
    throw new PlanManagerError(i18n.gitlabUrlInvalid[locale](safeUrl), 'INVALID_GITLAB_BASE_URL')
  }

  if (parsed.protocol !== 'https:') {
    const locale = getLocale()
    throw new PlanManagerError(i18n.gitlabUrlInvalid[locale](safeUrl), 'INVALID_GITLAB_BASE_URL')
  }

  return trimmed.replace(/\/+$/, '')
}
