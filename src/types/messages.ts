/**
 * Shared type definitions for the WebviewView messaging protocol.
 *
 * Used by both the Extension Host (webviewViewProvider.ts) and
 * the Webview client to ensure type-safe communication.
 */

// ---------------------------------------------------------------------------
// Serialized data
// ---------------------------------------------------------------------------

export interface SerializedPlanFile {
  /** Absolute file path — used as unique ID */
  filePath: string
  /** Display file name (e.g. "curried-hugging-quokka.md") */
  fileName: string
  /** Plan source tool */
  source: 'claude' | 'cursor'
  /** Title (H1 for Claude, frontmatter name for Cursor) */
  name: string
  /** Short description (overview first paragraph, max 200 chars) */
  description: string
  /** Last-modified timestamp in ISO 8601 */
  modifiedAt: string
  /** File size in bytes */
  size: number
  /** First 2000 characters of markdownBody for client-side search */
  searchableBody: string
  /** Todo progress for Cursor plans; null when not applicable */
  todoProgress: { done: number; total: number } | null
}

// ---------------------------------------------------------------------------
// Persisted webview state
// ---------------------------------------------------------------------------

export interface PersistedWebviewState {
  /** IDs of collapsed source groups */
  collapsedGroups: string[]
  /** Scroll position for restoration (deprecated — kept for backward compat) */
  scrollTop: number
  /** Currently focused plan card */
  focusedPlanId: string | null
  /** Active search query text */
  searchQuery: string
  /** Split ratio for top pane (0..1). Undefined falls back to 0.5 */
  splitRatio?: number
  /** Per-pane scroll positions */
  paneScrollTops?: { claude: number; cursor: number }
}

// ---------------------------------------------------------------------------
// Extension Host → Webview messages
// ---------------------------------------------------------------------------

export type HostToWebviewMessage =
  | { type: 'plansLoaded'; plans: SerializedPlanFile[] }
  | { type: 'focusSearch' }
  | { type: 'clearSearch' }
  | { type: 'configChanged'; sortBy: string; defaultClickAction: string }
  | ({ type: 'restoreState' } & PersistedWebviewState)
  | { type: 'commandError'; command: string; planId: string; message: string }

// ---------------------------------------------------------------------------
// Webview → Extension Host messages
// ---------------------------------------------------------------------------

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'command'; command: string; planId: string }
  | { type: 'searchStateChanged'; isActive: boolean }
  | { type: 'requestRefresh' }
  | ({ type: 'stateChanged' } & PersistedWebviewState)
  | { type: 'error'; message: string; context?: string }
