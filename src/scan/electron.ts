import fs from 'node:fs/promises'
import path from 'node:path'
import { exists } from '../util/exists.ts'
import type { PathScanner, RawCandidate } from './scanner.ts'
const CLAIMABLE = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']
async function dirs(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
export const electronScanner: PathScanner = {
  name: 'electron',
  group: 'caches',
  async probe(ctx) {
    const out: RawCandidate[] = []
    const base = path.join(ctx.home, 'Library', 'Application Support')
    for (const app of await dirs(base)) {
      const root = path.join(base, app)
      const profiles = [root, ...(await dirs(path.join(root, 'Partitions')))
        .map((name) => path.join(root, 'Partitions', name))]
      for (const profile of profiles) {
        if (!(await exists(path.join(profile, 'Cache'))) || !(await exists(path.join(profile, 'Code Cache')))) continue
        const name = profile === root ? app : `${app} ${path.basename(profile)}`
        for (const sub of CLAIMABLE) {
          const full = path.join(profile, sub)
          if (await exists(full)) out.push({ path: full, label: `${name} ${sub}`, group: 'caches' })
        }
      }
    }
    return out
  },
}
