import { ALLOW, type Guard } from './guard.ts'

/**
 * Whole groups whose rows are real, non-regenerable data: an uninstalled
 * app's settings, a device backup, Docker's VM disk. Deleting one is a loss,
 * not a cleanup — so every row arrives unchecked with a warning saying
 * exactly what the loss is, and the TUI keeps it out of select-all and the
 * group checkbox. Checking the row itself is the only way to opt in.
 *
 * Until v0.6 these groups were report-only ('report'): visible, never
 * deletable. That protected people who did not read the row, but it also
 * meant the tool showed you 70 GB and then refused to help. 'danger' keeps
 * the friction — nothing here can be swept up in bulk — while honouring an
 * explicit, per-row decision.
 */
/** Heavy-row label → the exact loss. Prefix match, so `iOS backup <id>` works. */
const HEAVY_LOSS: Array<[string, string]> = [
  ['iOS backup', 'a device backup — deleting it is permanent'],
  ['Docker.raw', 'destroys all Docker containers, images & volumes — quit Docker Desktop first'],
  ['.Trash', 'empties the Trash for good'],
  ['Simulator devices', 'erases every simulator and its apps — xcrun simctl delete unavailable is gentler'],
  ['Android emulators', 'erases every Android emulator (AVD) and everything installed on it'],
  ['Android system images', 'emulators stop booting until re-downloaded via SDK Manager'],
  ['Ollama models', 'every model must be pulled again — tens of GB'],
  ['LM Studio models', 'every model must be downloaded again — tens of GB'],
  ['OrbStack data', 'destroys all OrbStack containers, images & machines — quit OrbStack first'],
]

export const dangerGuard: Guard = {
  name: 'danger',
  check(c) {
    if (c.group === 'orphans') {
      return { action: 'danger', warning: 'settings & data for an app that is gone — not regenerable' }
    }
    if (c.group === 'heavy') {
      const hit = HEAVY_LOSS.find(([prefix]) => c.label.startsWith(prefix))
      return { action: 'danger', warning: hit?.[1] ?? 'not regenerable — deletes real data' }
    }
    return ALLOW
  },
}
