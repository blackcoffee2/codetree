/**
 * Centralizes the tool's built-in, always-on exclusions.
 *
 * Every pattern here is a plain glob supplied to the globber's `ignore` option
 * during file discovery - the same channel used for patterns from the
 * `-e/--exclude` flag. These are deliberately kept out of the user's config
 * file: they always apply and cannot be edited away, so a freshly generated
 * `.codetree/config.json` starts with an empty `exclude` list that belongs
 * entirely to the user.
 *
 * Note that these are separate from the project's .gitignore, which the globber
 * reads and applies on its own; this list is not a substitute for it.
 */

/**
 * Directories that are never meaningful in a snapshot of any project,
 * regardless of language.
 *
 * Because they describe directories, the globber prunes them during traversal
 * rather than walking in and discarding the contents afterward. Membership is
 * limited to the version-control directory and the tool's own folder (which
 * holds the config and any output written there, and must never be fed back
 * into a snapshot). Language- or ecosystem-specific dependency and build
 * directories - node_modules, target, .venv, and so on - are intentionally left
 * to the project's .gitignore, which is always read and which reliably lists
 * them since they are not committed.
 */
const INTERNAL_DIRECTORY_EXCLUDES: string[] = ["**/.git/**", "**/.codetree/**"];

/**
 * Lockfiles, which are excluded everywhere by default.
 *
 * Unlike dependency directories, lockfiles are almost always committed to
 * source control, so a project's .gitignore does not list them and gitignore
 * alone never excludes them. They are also never useful in a snapshot meant for
 * an LLM. Rather than seed them into the user's config - where they would be
 * noise in projects that use only one ecosystem - they are applied here, always
 * and invisibly, in the same spirit as the directory exclusions above.
 *
 * Each entry is prefixed with `**\/` so it matches the file at any depth (for
 * example in the packages of a monorepo), since these are evaluated as globs.
 * The list spans the package managers commonly seen across the languages this
 * tool can parse plus a few widely used neighbors.
 */
const LOCKFILE_EXCLUDES: string[] = [
  // JavaScript / TypeScript
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/bun.lock",

  // Python
  "**/poetry.lock",
  "**/Pipfile.lock",

  // Rust
  "**/Cargo.lock",

  // Go
  "**/go.sum",

  // Java / Kotlin
  "**/gradle.lockfile",

  // Dart / Flutter
  "**/pubspec.lock",

  // Swift
  "**/Package.resolved",
  "**/Podfile.lock",

  // PHP
  "**/composer.lock",

  // Ruby
  "**/Gemfile.lock",

  // .NET
  "**/packages.lock.json",

  // Elixir
  "**/mix.lock",
];

/**
 * The complete set of always-on exclusion patterns.
 *
 * Combines the directory exclusions and the lockfile exclusions. Supplied to
 * the globber on every run and never merged into the user's config, so it
 * cannot be removed by editing the config file.
 */
export const INTERNAL_IGNORE_PATTERNS: string[] = [
  ...INTERNAL_DIRECTORY_EXCLUDES,
  ...LOCKFILE_EXCLUDES,
];
