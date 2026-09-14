import path from 'node:path'
import { exists } from '../util/exists.ts'
import type { PathScanner, RawCandidate } from './scanner.ts'
import { subdirNames } from './enumerate.ts'

/**
 * Things that are huge but NOT junk: device backups, the Trash, container VM
 * disks, every simulator and emulator, local LLM weights. The danger guard
 * marks every row here dangerous — shown unchecked with a warning naming the
 * loss, deletable only by checking the row itself. The note says which
 * native tool reclaims the space gently.
 */

/** Fixed home-relative probes: path → label → note. */
const FIXED: Array<[string, string, string]> = [
  ['Library/Developer/CoreSimulator/Devices', 'Simulator devices', 'xcrun simctl delete unavailable is gentler'],
  ['.android/avd', 'Android emulators', 'delete via Android Studio → Device Manager'],
  ['Library/Android/sdk/system-images', 'Android system images', 'remove via SDK Manager'],
  ['.ollama/models', 'Ollama models', 'ollama rm <model> is gentler'],
  ['.lmstudio/models', 'LM Studio models', 'delete via LM Studio → My Models'],
  ['.cache/lm-studio/models', 'LM Studio models', 'delete via LM Studio → My Models'],
  ['.orbstack/data', 'OrbStack data', 'orb prune is gentler'],
]
export const heavyScanner: PathScanner = {
  name: 'heavy',
  group: 'heavy',
  async probe(ctx) {
    const out: RawCandidate[] = []

    const backups = path.join(ctx.home, 'Library', 'Application Support', 'MobileSync', 'Backup')
    for (const name of await subdirNames(backups)) {
      out.push({
        path: path.join(backups, name),
        label: `iOS backup ${name}`,
        group: 'heavy',
        note: 'delete via Finder → manage backups',
      })
    }

    const trash = path.join(ctx.home, '.Trash')
    if (await exists(trash)) {
      out.push({ path: trash, label: '.Trash', group: 'heavy', note: 'empty via Finder' })
    }

    const dockerRaw = path.join(
      ctx.home, 'Library', 'Containers', 'com.docker.docker', 'Data', 'vms', '0', 'data', 'Docker.raw',
    )
    if (await exists(dockerRaw)) {
      out.push({
        path: dockerRaw,
        label: 'Docker.raw',
        group: 'heavy',
        note: 'shrink via Docker Desktop → disk size',
      })
    }

    for (const [rel, label, note] of FIXED) {
      const full = path.join(ctx.home, rel)
      if (await exists(full)) out.push({ path: full, label, group: 'heavy', note })
    }

    return out
  },
}
