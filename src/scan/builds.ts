import type { WalkScanner } from './scanner.ts'

/**
 * Output and cache directories that only ever hold regenerable state. The
 * name alone is enough: nobody hand-writes a `.next/` or a `.terraform/`.
 * (`.terraform/` holds downloaded providers and module copies; `terraform
 * init` recreates it. State lives in terraform.tfstate beside it, untouched.)
 */
const UNAMBIGUOUS = new Set([
  '.next', '.turbo', '.parcel-cache', '.svelte-kit', '.astro', '.nuxt',
  '.angular', '.docusaurus', '.serverless',
  '.terraform', '.dart_tool', '.gradle',
  '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
])

const JS_MANIFESTS = ['package.json', 'tsconfig.json', 'vite.config.js', 'vite.config.ts']

/**
 * Names that are only build output when a matching manifest sits beside
 * them — plenty of people have a hand-written `build/` directory of source,
 * and `target/` next to a package.json is nobody's convention. `target`
 * beside a Cargo.toml belongs to the cargo scanner.
 */
const AMBIGUOUS: Record<string, string[]> = {
  dist: JS_MANIFESTS,
  build: [
    ...JS_MANIFESTS,
    'pubspec.yaml',                                                       // Flutter / Dart
    'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', // Android / Gradle
    'CMakeLists.txt',                                                     // CMake
  ],
  target: ['pom.xml', 'build.sbt'],                                       // Maven / sbt
  '.cache': ['package.json'],                                             // gatsby, babel-loader, eslint, ...
}

export const buildsScanner: WalkScanner = {
  name: 'builds',
  group: 'builds',
  async inspect(v) {
    if (UNAMBIGUOUS.has(v.name)) {
      return { path: v.path, label: v.name, group: 'builds' }
    }
    const manifests = AMBIGUOUS[v.name]
    if (manifests !== undefined && manifests.some((m) => v.parentEntries.includes(m))) {
      return { path: v.path, label: v.name, group: 'builds' }
    }
    return null
  },
}
