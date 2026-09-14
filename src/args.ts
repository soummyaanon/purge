import { ALL_GROUPS, GROUP_ALIASES, type Group } from './types.ts'

export type Options = {
  command: 'scan' | 'history' | 'undo' | 'help' | 'version'
  groups: Group[]
  apply: boolean
  /** Move to ~/.Trash instead of deleting. Recoverable with `purge undo`. */
  trash: boolean
  dryRun: boolean
  json: boolean
  last: boolean
  staleDays: number
  minSizeBytes: number
}

const MB = 1024 * 1024

export function parseArgs(argv: string[], defaults: Partial<Options>): Options | { error: string } {
  const o: Options = {
    command: 'scan',
    groups: [],
    apply: false,
    trash: defaults.trash ?? false,
    dryRun: false,
    json: false,
    last: false,
    staleDays: defaults.staleDays ?? 60,
    minSizeBytes: defaults.minSizeBytes ?? 10 * MB,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    switch (a) {
      case '-y': case '--yes': o.apply = true; break
      case '--trash': o.trash = true; break
      case 'undo': o.command = 'undo'; break
      case '--dry-run': o.dryRun = true; break
      case '--json': o.json = true; break
      case '--last': o.last = true; break
      case '-h': case '--help': o.command = 'help'; break
      case '-v': case '--version': o.command = 'version'; break
      case 'history': o.command = 'history'; break
      case '--stale-days': {
        const n = Number(argv[++i])
        if (!Number.isFinite(n) || n < 0) return { error: '--stale-days needs a number' }
        o.staleDays = n
        break
      }
      case '--min-size': {
        const n = Number(argv[++i])
        if (!Number.isFinite(n) || n < 0) return { error: '--min-size needs a number of megabytes' }
        o.minSizeBytes = n * MB
        break
      }
      default: {
        if (a.startsWith('-')) return { error: `unknown option: ${a}` }
        const name = GROUP_ALIASES[a] ?? a
        if (!(ALL_GROUPS as string[]).includes(name)) {
          return { error: `unknown group: ${a} (try ${ALL_GROUPS.join(', ')})` }
        }
        o.groups.push(name as Group)
      }
    }
  }

  if (o.groups.length === 0) o.groups = defaults.groups ?? [...ALL_GROUPS]
  // --json is a reporting mode. It must never delete anything.
  if (o.json) { o.dryRun = true; o.apply = false }
  return o
}
