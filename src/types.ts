export type Group =
  | 'builds' | 'pkg' | 'xcode' | 'browsers' | 'editors'
  | 'caches' | 'logs' | 'agents' | 'orphans' | 'heavy'

export const ALL_GROUPS: Group[] = [
  'builds', 'pkg', 'xcode', 'caches', 'browsers', 'editors', 'agents', 'logs', 'orphans', 'heavy',
]

/**
 * Renamed groups keep working under their old names: a v0.2.0 cron job
 * running `purge claude` or a ~/.purgerc pinning ["claude"] must not break
 * (or worse, silently widen) on upgrade.
 */
export const GROUP_ALIASES: Record<string, Group> = { claude: 'agents' }

/** A thing purge found that could be deleted. */
export type Candidate = {
  /** Absolute path. */
  path: string
  /** Short label shown in the UI, e.g. '.next' or 'npm cache'. */
  label: string
  group: Group
  /** On-disk bytes, from stat.blocks * 512. Filled in by the sizing pass. */
  bytes: number
  /** Extra context shown dim beside the label, e.g. 'idle 214d'. */
  note?: string
}

/** What a guard decided about a candidate. */
export type Verdict =
  | { action: 'allow' }
  | { action: 'downgrade'; warning: string }
  /**
   * Deleting this destroys real, non-regenerable data (an iOS backup, an
   * uninstalled app's settings). Arrives unchecked and is skipped by every
   * bulk toggle — only checking the row itself opts in.
   */
  | { action: 'danger'; warning: string }
  /** Shown in the report, never selectable, never deletable. */
  | { action: 'report'; warning: string }
  | { action: 'block'; warning: string }

/** A candidate after the guard layer has run. */
export type Reviewed = Candidate & {
  /** Pre-checked in the TUI. False when a guard downgraded it. */
  selected: boolean
  /**
   * False when a guard returned 'report': the row is displayed so the user
   * knows the data exists, but it can never be checked and the reaper
   * refuses it outright.
   */
  selectable: boolean
  /**
   * True when a guard returned 'danger'. The row can be checked, but only
   * one at a time by the user's own hand: select-all and the group checkbox
   * pass over it, and it is never pre-checked. Absent means false.
   */
  dangerous?: boolean
  /** Shown beside the row. Empty when no guard objected. */
  warnings: string[]
}

/** One line in a run manifest. */
export type ReapedItem = {
  path: string
  bytes: number
  group: Group
  /** Where a --trash run moved it. Absent when it was deleted for real. */
  trashedTo?: string
}

/**
 * A path the user chose that the reaper could not remove: permission denied,
 * a file held open, a directory that refilled mid-delete. Recorded so the
 * summary can name it instead of letting it vanish into "skipped".
 */
export type FailedItem = ReapedItem & { reason: string }

export type RunManifest = {
  ts: string
  version: string
  freedBytes: number
  groups: Group[]
  items: ReapedItem[]
  /** Absent in manifests written before v0.8. */
  failed?: FailedItem[]
  /** How items left: deleted, or moved to ~/.Trash. Absent (pre-v0.8) means 'rm'. */
  mode?: 'rm' | 'trash'
  /** Set by `purge undo` once this run's items were moved back. */
  undoneAt?: string
}
