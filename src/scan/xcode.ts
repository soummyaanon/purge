import path from 'node:path'
import { exists } from '../util/exists.ts'
import type { PathScanner, RawCandidate } from './scanner.ts'

/**
 * Xcode Archives are deliberately absent from this list. They are shipping
 * artifacts containing dSYMs needed to symbolicate crash reports from
 * already-released builds — losing one is unrecoverable.
 */
const TARGETS: Array<[string, string, string | undefined]> = [
  ['Library/Developer/Xcode/DerivedData', 'Xcode DerivedData', undefined],
  ['Library/Developer/Xcode/iOS DeviceSupport', 'iOS DeviceSupport', 'needs that exact device + iOS build to rebuild'],
  ['Library/Developer/Xcode/watchOS DeviceSupport', 'watchOS DeviceSupport', 'needs that exact device + OS build to rebuild'],
  ['Library/Developer/CoreSimulator/Caches', 'Simulator caches', undefined],
  // The simulators SwiftUI previews boot. Rebuilt the next time a canvas opens.
  ['Library/Developer/Xcode/UserData/Previews', 'Xcode Previews', undefined],
]

export const xcodeScanner: PathScanner = {
  name: 'xcode',
  group: 'xcode',
  async probe(ctx) {
    const out: RawCandidate[] = []
    for (const [rel, label, note] of TARGETS) {
      const full = path.join(ctx.home, rel)
      if (await exists(full)) out.push({ path: full, label, group: 'xcode', ...(note ? { note } : {}) })
    }
    return out
  },
}
