import path from "path";
import type { Language } from "web-tree-sitter";

export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "tsx"
  | "jsx"
  | "python"
  | "java"
  | "go"
  | "rust"
  | "cpp"
  | "c"
  | "dart"
  | "swift"
  | "kotlin";

/**
 * Maps each supported language to its grammar file name within the
 * tree-sitter-wasms package's `out` directory.
 *
 * The grammars are loaded as WebAssembly via web-tree-sitter, so there is no
 * native compilation step. Several names differ from the language key: TSX has
 * its own grammar file, and JSX reuses the JavaScript grammar (there is no
 * separate JSX grammar), mirroring the previous native setup.
 */
const WASM_FILE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  jsx: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  java: "tree-sitter-java.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  cpp: "tree-sitter-cpp.wasm",
  c: "tree-sitter-c.wasm",
  dart: "tree-sitter-dart.wasm",
  swift: "tree-sitter-swift.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
};

export class LanguageDetector {
  private extensionMap: Map<string, SupportedLanguage>;

  // Loaded grammars are cached so each .wasm file is read and compiled at most
  // once for the lifetime of the detector, rather than per file processed.
  private loadedLanguages: Map<SupportedLanguage, Language>;

  // Resolved absolute path to the tree-sitter-wasms `out` directory, computed
  // lazily on first use.
  private wasmDirectory: string | null = null;

  constructor() {
    this.loadedLanguages = new Map();

    this.extensionMap = new Map([
      // JavaScript and JSX
      [".js", "javascript"],
      [".mjs", "javascript"],
      [".cjs", "javascript"],
      [".jsx", "jsx"],

      // TypeScript and TSX
      // Note: there is no ".d.ts" entry because path.extname() reports ".ts"
      // for declaration files, so the ".ts" mapping already covers them.
      [".ts", "typescript"],
      [".tsx", "tsx"],

      // Python
      [".py", "python"],
      [".pyw", "python"],
      [".py3", "python"],

      // Java
      [".java", "java"],

      // Go
      [".go", "go"],

      // Rust
      [".rs", "rust"],

      // C++
      [".cpp", "cpp"],
      [".cxx", "cpp"],
      [".cc", "cpp"],
      [".c++", "cpp"],
      [".hpp", "cpp"],
      [".hxx", "cpp"],
      [".hh", "cpp"],
      [".h++", "cpp"],

      // C
      [".c", "c"],
      [".h", "c"],

      // Dart
      [".dart", "dart"],

      // Swift
      [".swift", "swift"],

      // Kotlin
      [".kt", "kotlin"],
      [".kts", "kotlin"],
    ]);
  }

  detectLanguage(filePath: string): SupportedLanguage | null {
    const extension = path.extname(filePath).toLowerCase();
    return this.extensionMap.get(extension) || null;
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  getSupportedLanguages(): SupportedLanguage[] {
    return Object.keys(WASM_FILE_BY_LANGUAGE) as SupportedLanguage[];
  }

  isSupported(filePath: string): boolean {
    return this.detectLanguage(filePath) !== null;
  }

  /**
   * Resolve the directory that holds the grammar .wasm files.
   *
   * The files are shipped inside the tree-sitter-wasms package, so the package
   * is located via require.resolve and the bundled `out` directory is used.
   * This works both when running from source and from the compiled output,
   * since the dependency is present in node_modules in both cases.
   */
  private getWasmDirectory(): string {
    if (this.wasmDirectory) {
      return this.wasmDirectory;
    }

    const packageJsonPath = require.resolve("tree-sitter-wasms/package.json");
    this.wasmDirectory = path.join(path.dirname(packageJsonPath), "out");
    return this.wasmDirectory;
  }

  /**
   * Load and return the grammar for a language, or null when it cannot be
   * loaded.
   *
   * Grammars are cached after first load. A null result is returned rather than
   * substituting a different language when the grammar file is missing or fails
   * to compile; callers treat null as "no structural summary available" and
   * list the file without symbols, which is preferable to parsing it as the
   * wrong language and emitting a misleading summary.
   *
   * web-tree-sitter must be initialized (Parser.init) before this is called.
   * The runtime value of Language is obtained through a dynamic import so this
   * CommonJS build works whether web-tree-sitter is published as ESM or
   * CommonJS; the import is cached, so this shares the runtime that the caller
   * already initialized.
   */
  async getSafeParser(language: SupportedLanguage): Promise<Language | null> {
    const cached = this.loadedLanguages.get(language);
    if (cached) {
      return cached;
    }

    try {
      const fileName = WASM_FILE_BY_LANGUAGE[language];
      if (!fileName) {
        console.warn(
          `No grammar mapping for ${language}, skipping structural analysis`
        );
        return null;
      }

      const wasmPath = path.join(this.getWasmDirectory(), fileName);
      const { Language } = await import("web-tree-sitter");
      const loaded = await Language.load(wasmPath);

      this.loadedLanguages.set(language, loaded);
      return loaded;
    } catch (error) {
      console.warn(
        `Error loading grammar for ${language}: ${error}, skipping structural analysis`
      );
      return null;
    }
  }
}
