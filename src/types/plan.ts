export enum PlanSource {
  ClaudeCode = 'claude',
  Cursor = 'cursor',
}

export enum TodoStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
}

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

export interface CursorFrontmatter {
  name: string
  overview: string
  todos: TodoItem[]
  isProject: boolean
}

export interface PlanFile {
  filePath: string
  fileName: string
  source: PlanSource
  name: string
  createdAt: Date
  modifiedAt: Date
  size: number
  frontmatter: CursorFrontmatter | null
  markdownBody: string
}

/** Normalize Cursor's `complete` variant to `completed` */
export function normalizeTodoStatus(raw: string): TodoStatus {
  if (raw === 'complete' || raw === 'completed') return TodoStatus.Completed
  if (raw === 'in_progress') return TodoStatus.InProgress
  return TodoStatus.Pending
}
