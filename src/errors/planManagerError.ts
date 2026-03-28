export type ErrorCode = 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'CONVERSION_ERROR' | 'WATCH_ERROR'

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
