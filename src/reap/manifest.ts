import fs from 'node:fs/promises'
import path from 'node:path'
import type { RunManifest } from '../types.ts'

/** Writes one run manifest and returns the file path. */
export async function writeManifest(runsDir: string, m: RunManifest): Promise<string> {
  await fs.mkdir(runsDir, { recursive: true })
  const safeTs = m.ts.replace(/[:.]/g, '-')
  const file = path.join(runsDir, `${safeTs}.json`)
  await fs.writeFile(file, JSON.stringify(m, null, 2))
  return file
}

export type ManifestEntry = { file: string; manifest: RunManifest }

/**
 * Every past run with the file it came from, newest first. Unreadable or
 * malformed files are skipped.
 */
export async function readManifestEntries(runsDir: string): Promise<ManifestEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(runsDir)
  } catch {
    return []
  }

  const out: ManifestEntry[] = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const file = path.join(runsDir, name)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as RunManifest
      if (typeof parsed.ts === 'string' && Array.isArray(parsed.items)) out.push({ file, manifest: parsed })
    } catch { /* a corrupt manifest must never break `purge history` */ }
  }

  return out.sort((a, b) => b.manifest.ts.localeCompare(a.manifest.ts))
}

/** Every past run, newest first. */
export async function readManifests(runsDir: string): Promise<RunManifest[]> {
  return (await readManifestEntries(runsDir)).map((e) => e.manifest)
}

/** Overwrites one existing manifest in place — used to mark a run undone. */
export async function rewriteManifest(file: string, m: RunManifest): Promise<void> {
  await fs.writeFile(file, JSON.stringify(m, null, 2))
}
