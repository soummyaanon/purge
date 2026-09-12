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
      // shadowed by its own cache subdirs.
      if (claimed?.has(root) === true) continue
      const subs = await subdirNames(root)
      if (!SIGNATURE.every((s) => subs.includes(s))) continue
      for (const sub of CLAIMABLE) {
        if (!subs.includes(sub)) continue
        const full = path.join(root, sub)
        if (claimed?.has(full) === true) continue
        out.push({ path: full, label: `${app} ${sub}`, group: 'caches' })
      }
    }
    return out
  },
}
