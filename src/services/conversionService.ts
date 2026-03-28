import { PlanFile, PlanSource, TodoStatus, CursorFrontmatter, TodoItem } from '../types/plan'
import { parseFrontmatter, serializeFrontmatter } from '../utils/frontmatterParser'
import {
  extractH1,
  hasH1,
  extractSectionHeadings,
  extractCheckboxes,
  extractSectionContent,
  extractFirstParagraph,
} from '../utils/markdownParser'

/**
 * Convert a Claude Code plan to Cursor plan format.
 *
 * Algorithm (verified against real files):
 * 1. H1 → name (fallback: filename)
 * 2. Context/Overview section → overview (fallback: first paragraph)
 * 3. H2/H3 headings → todos (PRIMARY path — Claude plans use headings, not checkboxes)
 * 4. Checkboxes → todos (supplementary, outside code blocks only)
 * 5. Serialize with yaml.dump()
 */
export function convertClaudeToCursor(plan: PlanFile): string {
  const content = plan.markdownBody

  // 1. Extract name
  const name = extractH1(content) ?? plan.fileName.replace(/\.md$/, '')

  // 2. Extract overview
  const overview =
    extractSectionContent(content, ['context', 'overview', '概要', '背景']) ??
    extractFirstParagraph(content) ??
    ''

  // 3. Extract todos from H2/H3 headings (primary)
  const headings = extractSectionHeadings(content)
  const todos: TodoItem[] = headings.map((h, i) => ({
    id: `section-${i + 1}`,
    content: h.text,
    status: TodoStatus.Pending,
  }))

  // 4. Supplement with checkboxes (if any exist outside code blocks)
  if (todos.length === 0) {
    const checkboxes = extractCheckboxes(content)
    for (let i = 0; i < checkboxes.length; i++) {
      todos.push({
        id: `task-${i + 1}`,
        content: checkboxes[i].text,
        status: checkboxes[i].checked ? TodoStatus.Completed : TodoStatus.Pending,
      })
    }
  }

  const frontmatter: CursorFrontmatter = {
    name,
    overview,
    todos,
    isProject: false,
  }

  return serializeFrontmatter(frontmatter, content)
}

/**
 * Convert a Cursor plan to Claude Code plan format.
 *
 * Algorithm (verified against real files):
 * 1. Remove YAML frontmatter
 * 2. Add H1 from name ONLY if body doesn't already have H1 (94/97 files have H1)
 * 3. Add Overview section if missing
 * 4. Add Tasks checkbox list from todos (skip duplicates already in body)
 * 5. Normalize `complete` → `completed`
 */
export function convertCursorToClaude(plan: PlanFile): string {
  if (!plan.frontmatter) return plan.markdownBody

  const fm = plan.frontmatter
  const body = plan.markdownBody
  const parts: string[] = []

  // 2. Add H1 only if body doesn't have one
  if (!hasH1(body)) {
    const title = fm.name || 'Untitled Plan'
    parts.push(`# ${title}`)
    parts.push('')
  }

  // 3. Add Overview section if not present in body
  if (fm.overview && !body.toLowerCase().includes('## overview') && !body.toLowerCase().includes('## 概要')) {
    parts.push('## Overview')
    parts.push('')
    parts.push(fm.overview)
    parts.push('')
  }

  // Add original body
  parts.push(body)

  // 4. Add Tasks from todos (skip if already present in body)
  if (fm.todos.length > 0) {
    const bodyLower = body.toLowerCase()
    const newTodos = fm.todos.filter(
      (t) => !bodyLower.includes(t.content.toLowerCase().slice(0, 30)),
    )

    if (newTodos.length > 0) {
      parts.push('')
      parts.push('## Tasks')
      parts.push('')
      for (const t of newTodos) {
        const check = t.status === TodoStatus.Completed ? 'x' : ' '
        parts.push(`- [${check}] ${t.content}`)
      }
    }
  }

  return parts.join('\n') + '\n'
}
