import path from 'node:path'
import type { PathScanner, RawCandidate } from './scanner.ts'
import { subdirNames } from './enumerate.ts'

/**
 * Every Electron app keeps a Chromium profile in
 * ~/Library/Application Support/<App>/ with the same cache directories, and
 * the same rule applies to all of them: `Cache`, `Code Cache` and the GPU
 * shader caches are rebuilt on next launch, while `Local Storage`,
 * `IndexedDB`, `Session Storage` and `Service Worker` hold login state and
 * app data and are never touched. Detecting the profile by its signature —
 * both `Cache` AND `Code Cache` present — lets Slack, Discord, Notion, Figma,
 * Postman, Teams and any app purge has never heard of get the same cleaning
 * the editors scanner gives VS Code.
 *
 * Some apps (Teams, Postman, some Slack builds) keep extra Chromium profiles
 * one level down at `<App>/Partitions/<name>/` with the same layout, and
 * those are often the larger ones. Each partition is judged by the same
 * signature and yields the same claimable set, labelled `<App> <name> …`.
 */

/** Directories other scanners own. Their group decides what is claimable. */
const OWNED: ReadonlySet<string> = new Set([
  'Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium', 'Zed',   // editors
  'Claude',                                                              // agents
  'Google', 'Comet', 'BraveSoftware', 'Microsoft Edge', 'Arc',           // browsers
  'MobileSync',                                                          // heavy
])

/** A lone `Cache` folder proves nothing; both are required. */
const SIGNATURE = ['Cache', 'Code Cache']

const CLAIMABLE = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']

export const electronScanner: PathScanner = {
  name: 'electron',
  group: 'caches',
  async probe(ctx, claimed) {
    const out: RawCandidate[] = []
    const base = path.join(ctx.home, 'Library', 'Application Support')
    for (const app of await subdirNames(base)) {
      if (OWNED.has(app)) continue
      const root = path.join(base, app)
      // An orphan scanner already offering the whole folder must not be
      // shadowed by its own cache subdirs — nor by its partitions'.
      if (claimed?.has(root) === true) continue
      const partitions = path.join(root, 'Partitions')
      const profiles: Array<{ dir: string; name: string }> = [{ dir: root, name: app }]
      for (const p of await subdirNames(partitions)) {
        profiles.push({ dir: path.join(partitions, p), name: `${app} ${p}` })
      }
      for (const { dir, name } of profiles) {
        const subs = await subdirNames(dir)
        if (!SIGNATURE.every((s) => subs.includes(s))) continue
        for (const sub of CLAIMABLE) {
          if (!subs.includes(sub)) continue
          const full = path.join(dir, sub)
          if (claimed?.has(full) === true) continue
          out.push({ path: full, label: `${name} ${sub}`, group: 'caches' })
        }
      }
    }
    return out
  },
}
