import * as os from 'os'
import * as path from 'path'

/** Expand `~` to the user's home directory. Never use literal `~` in file APIs. */
export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

/** Get the default Claude plans directory */
export function getClaudePlansDir(): string {
  return path.join(os.homedir(), '.claude', 'plans')
}

/** Get the default Cursor plans directory */
export function getCursorPlansDir(): string {
  return path.join(os.homedir(), '.cursor', 'plans')
}
