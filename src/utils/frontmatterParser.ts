import matter from 'gray-matter'
import { stringify as yamlStringify } from 'yaml'
import type { CursorFrontmatter, TodoItem } from '../types/plan'
import { normalizeTodoStatus } from '../types/plan'

interface ParseResult {
  frontmatter: CursorFrontmatter | null
  body: string
}

/**
 * Parse YAML frontmatter from a Cursor plan file.
 * Uses gray-matter which correctly handles `---` horizontal rules in the body.
 */
export function parseFrontmatter(content: string): ParseResult {
  try {
    const { data, content: body } = matter(content)

    if (!data || typeof data.name !== 'string') {
      return { frontmatter: null, body: content }
    }

    const todos: TodoItem[] = Array.isArray(data.todos)
      ? data.todos.map((t: any) => ({
          id: String(t.id ?? ''),
          content: String(t.content ?? ''),
          status: normalizeTodoStatus(String(t.status ?? 'pending')),
        }))
      : []

    return {
      frontmatter: {
        name: data.name,
        overview: String(data.overview ?? ''),
        todos,
        isProject: Boolean(data.isProject),
      },
      body: body.trim(),
    }
  } catch {
    return { frontmatter: null, body: content }
  }
}

/**
 * Serialize a CursorFrontmatter object to a YAML frontmatter string + body.
 * Always uses yaml.dump() — never hand-construct YAML.
 */
export function serializeFrontmatter(fm: CursorFrontmatter, body: string): string {
  const yamlObj: Record<string, unknown> = {
    name: fm.name,
    overview: fm.overview,
    todos: fm.todos.map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status,
    })),
  }
  if (fm.isProject) {
    yamlObj.isProject = true
  }

  const yamlStr = yamlStringify(yamlObj, { lineWidth: 0 }).trim()
  return `---\n${yamlStr}\n---\n\n${body}\n`
}
