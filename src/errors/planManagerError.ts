export type ErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'CONVERSION_ERROR'
  | 'WATCH_ERROR'
  | 'GIT_REMOTE_NOT_FOUND'
  | 'UNSUPPORTED_REMOTE'
  | 'INVALID_GITLAB_BASE_URL'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'API_REQUEST_FAILED'
  | 'NETWORK_ERROR'

export class PlanManagerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'PlanManagerError'
  }
}
