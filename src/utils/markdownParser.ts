/**
 * Extract the first H1 heading from markdown content.
 * Returns null if no H1 is found.
 */
export function extractH1(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

/**
 * Check if the markdown body already contains an H1 heading.
 */
export function hasH1(content: string): boolean {
  return /^#\s+/m.test(content)
}

/**
 * Extract H2/H3 section headings as todo-like items.
 * This is the PRIMARY extraction path for Claude plans (which use H2/H3 structure, not checkboxes).
 */
export function extractSectionHeadings(content: string): { level: number; text: string }[] {
  const results: { level: number; text: string }[] = []
  const lines = content.split('\n')
  let inCodeBlock = false

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{2,3})\s+(.+)$/)
    if (match) {
      results.push({ level: match[1].length, text: match[2].trim() })
    }
  }

  return results
}

/**
 * Extract checkboxes from markdown content (supplementary path).
 * Skips checkboxes inside code blocks.
 */
export function extractCheckboxes(content: string): { checked: boolean; text: string }[] {
  const results: { checked: boolean; text: string }[] = []
  const lines = content.split('\n')
  let inCodeBlock = false

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^[\s]*-\s+\[([ xX])\]\s+(.+)$/)
    if (match) {
      results.push({
        checked: match[1] !== ' ',
        text: match[2].trim(),
      })
    }
  }

  return results
}

/**
 * Extract the first paragraph after a specific section heading.
 * Used to find Context/Overview content.
 */
export function extractSectionContent(content: string, sectionNames: string[]): string | null {
  const lines = content.split('\n')
  let inCodeBlock = false
  let capturing = false
  const captured: string[] = []

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      if (capturing) {
        captured.push(line)
      }
      continue
    }

    if (!inCodeBlock && /^#{1,3}\s+/.test(line)) {
      if (capturing) break
      const headingText = line.replace(/^#{1,3}\s+/, '').trim().toLowerCase()
      if (sectionNames.some((s) => headingText.includes(s.toLowerCase()))) {
        capturing = true
      }
      continue
    }

    if (capturing) {
      captured.push(line)
    }
  }

  const result = captured.join('\n').trim()
  return result || null
}

/**
 * Extract the first non-empty paragraph from markdown (fallback for overview).
 */
export function extractFirstParagraph(content: string): string | null {
  const lines = content.split('\n')
  const paragraph: string[] = []
  let started = false

  for (const line of lines) {
    if (line.startsWith('#')) continue
    if (line.trim() === '') {
      if (started) break
      continue
    }
    started = true
    paragraph.push(line)
  }

  const result = paragraph.join('\n').trim()
  return result || null
}
