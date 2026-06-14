/**
 * Thin wrapper around the system clipboard.
 *
 * clipboardy is published as a pure ES module, so it cannot be loaded with a
 * plain require. This project compiles with "module": "commonjs", and under that
 * setting TypeScript rewrites a normal dynamic `import("clipboardy")` into a
 * `require()` call, which throws ERR_REQUIRE_ESM for a pure-ESM package. To get a
 * genuine runtime `import()` - which Node permits from CommonJS and which loads
 * ESM correctly - the import expression is constructed through the Function
 * constructor so the TypeScript transform leaves it untouched. The grammar
 * loader elsewhere in the project can use a direct dynamic import because its
 * dependency is require-compatible; clipboardy is not, hence this indirection.
 *
 * The import is evaluated on demand inside copyToClipboard rather than at module
 * load, so importing this file has no side effects and the dependency is only
 * touched when a copy is actually requested.
 */
const dynamicImport = new Function(
  "specifier",
  "return import(specifier);"
) as unknown as (specifier: string) => Promise<{
  default: { write(text: string): Promise<void> };
}>;

/**
 * Writes the given text to the system clipboard.
 *
 * Rejects if the clipboard is unavailable, which happens routinely in headless,
 * SSH, or CI environments where no clipboard provider is present. Callers are
 * expected to catch the rejection and fall back to printing the text so that it
 * is never lost.
 */
export async function copyToClipboard(text: string): Promise<void> {
  const clipboard = (await dynamicImport("clipboardy")).default;
  await clipboard.write(text);
}
