/** The oldest Node the test matrix runs. Mirrors `engines.node` in package.json. */
export const MIN_NODE = '22.18.0'

function parts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => Number(n) || 0)
}

/**
 * A one-line notice when the running Node is older than the tested minimum,
 * or null when it is fine. Advisory, never fatal: the bundle happens to parse
 * on older Nodes, and refusing to run would only hurt someone whose Node
 * would have worked.
 */
export function nodeVersionNotice(running: string): string | null {
  const [a, b, c] = parts(running)
  const [x, y, z] = parts(MIN_NODE)
  const older = (a ?? 0) < (x ?? 0)
    || ((a ?? 0) === (x ?? 0) && (b ?? 0) < (y ?? 0))
    || ((a ?? 0) === (x ?? 0) && (b ?? 0) === (y ?? 0) && (c ?? 0) < (z ?? 0))
  if (!older) return null
  return `purge is tested on Node ${MIN_NODE}+ and you are running ${running.replace(/^v/, '')} — if something misbehaves, upgrade Node first.`
}
