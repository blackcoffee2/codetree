import { ParsedFile, AnalysisStats } from "../types";
import path from "path";

interface CompactSymbol {
  type: "fn" | "cls" | "imp" | "exp" | "var" | "mod";
  name: string;
  line?: number;
  parentClass?: string; // Track which class a method belongs to
}

interface ClassWithMethods {
  name: string;
  methods: string[];
  line?: number;
}

interface DirectoryNode {
  files: Map<string, CompactSymbol[]>;
  subdirectories: Map<string, DirectoryNode>;
}

export class CompactTextGenerator {
  static generate(parsedFiles: ParsedFile[], rootDirectory: string): string {
    const stats = this.generateStats(parsedFiles);
    const directoryTree = this.buildDirectoryTree(parsedFiles);

    const lines: string[] = [];

    // Project header with global stats
    const projectName = path.basename(rootDirectory);
    lines.push(
      `# ${projectName} (${stats.totalFiles} files, ${this.formatLines(
        stats.totalLines
      )} lines)`
    );

    // Language distribution in compact format
    const langStats = Object.entries(stats.languageDistribution)
      .map(([lang, count]) => `${this.abbreviateLanguage(lang)}:${count}`)
      .join(" ");
    lines.push(langStats);

    // Add symbol legend for clarity
    lines.push("");
    lines.push(
      "Symbol Legend: fn=functions, cls=classes/types, imp=imports, exp=exports, var=variables, mod=modules"
    );
    lines.push(
      "Format: cls:ClassName(method1,method2) - parentheses show class methods, fn:function for standalone functions"
    );
    lines.push(""); // Empty line for readability

    // Directory structure
    this.generateDirectoryOutput(directoryTree, lines, 0);

    return lines.join("\n");
  }

  private static buildDirectoryTree(parsedFiles: ParsedFile[]): DirectoryNode {
    const root: DirectoryNode = {
      files: new Map(),
      subdirectories: new Map(),
    };

    for (const file of parsedFiles) {
      const pathParts = file.fileInfo.relativePath.split(path.sep);
      const fileName = pathParts[pathParts.length - 1];
      const dirParts = pathParts.slice(0, -1);

      // Navigate/create directory structure
      let currentNode = root;
      for (const dirPart of dirParts) {
        if (!currentNode.subdirectories.has(dirPart)) {
          currentNode.subdirectories.set(dirPart, {
            files: new Map(),
            subdirectories: new Map(),
          });
        }
        currentNode = currentNode.subdirectories.get(dirPart)!;
      }

      // Extract symbols from the file
      const symbols = this.extractCompactSymbols(file);
      currentNode.files.set(fileName, symbols);
    }

    return root;
  }

  private static extractCompactSymbols(file: ParsedFile): CompactSymbol[] {
    const symbols: CompactSymbol[] = [];

    if (!file.structuralSummary) {
      return symbols;
    }

    const lines = file.structuralSummary.split("\n");
    let currentClass: string | null = null;
    let indentationStack: Array<{ indent: number; className: string }> = [];

    for (const line of lines) {
      if (
        !line.trim() ||
        line.trim().startsWith("===") ||
        line.trim() === "No significant structures found"
      ) {
        continue;
      }

      // Calculate indentation level to determine nesting
      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      // Update indentation stack - remove deeper levels
      indentationStack = indentationStack.filter(
        (item) => item.indent < indent
      );

      // Parse the structural summary format
      const lineMatch = trimmed.match(/\(line (\d+)\)$/);
      const lineNumber = lineMatch ? parseInt(lineMatch[1]) : undefined;

      // Remove line number part for parsing
      const content = lineMatch
        ? trimmed.replace(/\s*\(line \d+\)$/, "")
        : trimmed;

      // Extract symbol based on node type and content
      const symbol = this.parseSymbolFromContent(content);
      if (symbol) {
        symbol.line = lineNumber;

        // If this is a class, update our tracking
        if (symbol.type === "cls") {
          currentClass = symbol.name;
          indentationStack.push({ indent, className: symbol.name });
        } else if (symbol.type === "fn") {
          // Determine if this function is inside a class based on indentation
          if (indentationStack.length > 0) {
            const parentClass =
              indentationStack[indentationStack.length - 1].className;
            symbol.parentClass = parentClass;
          }
        }

        symbols.push(symbol);
      }
    }

    return symbols;
  }

  private static parseSymbolFromContent(content: string): CompactSymbol | null {
    // Remove indentation and split by colon
    const parts = content.split(":");
    if (parts.length < 2) return null;

    const nodeType = parts[0].trim();
    const nodeContent = parts.slice(1).join(":").trim();

    // Determine symbol type and extract name. Constructor node types are
    // grouped with functions so they render as methods of their class rather
    // than falling through to the variable branch below via their
    // "declaration" suffix.
    if (
      nodeType.includes("function") ||
      nodeType.includes("method") ||
      nodeType.includes("constructor")
    ) {
      const name = this.extractFunctionName(nodeContent);
      return name ? { type: "fn", name } : null;
    }

    if (
      nodeType.includes("class") ||
      nodeType.includes("interface") ||
      nodeType.includes("struct") ||
      nodeType.includes("enum") ||
      nodeType.includes("record")
    ) {
      const name = this.extractTypeName(nodeContent);
      return name ? { type: "cls", name } : null;
    }

    // "use" covers node types like use_declaration; "using" is checked
    // separately because it does not contain "use" as a substring, so node
    // types like using_directive would otherwise fall through to the variable
    // branch or be dropped.
    if (
      nodeType.includes("import") ||
      nodeType.includes("use") ||
      nodeType.includes("using") ||
      nodeType.includes("require")
    ) {
      const name = this.extractImportName(nodeContent);
      return name ? { type: "imp", name } : null;
    }

    if (nodeType.includes("export")) {
      const name = this.extractExportName(nodeContent);
      return name ? { type: "exp", name } : null;
    }

    // Modules and namespaces are checked before the variable branch because
    // node types like namespace_declaration also contain "declaration" and
    // would otherwise be misclassified as variables.
    if (nodeType.includes("module") || nodeType.includes("namespace")) {
      const name = this.extractModuleName(nodeContent);
      return name ? { type: "mod", name } : null;
    }

    if (
      nodeType.includes("variable") ||
      nodeType.includes("declaration") ||
      nodeType.includes("const") ||
      nodeType.includes("let")
    ) {
      const name = this.extractVariableName(nodeContent);
      return name ? { type: "var", name } : null;
    }

    return null;
  }

  private static extractFunctionName(content: string): string | null {
    // Look for function patterns: "function name", "name(", "export function name"
    const patterns = [
      /(?:function\s+|export\s+function\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  private static extractTypeName(content: string): string | null {
    const patterns = [
      /(?:class|interface|struct|enum|type|record)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*{/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  private static extractImportName(content: string): string | null {
    // Extract what's being imported: "import { X } from", "import X from", "from 'module'"
    const patterns = [
      /from\s+['"]([^'"]+)['"]/,
      /import\s+['"]([^'"]+)['"]/,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      // Using directives and declarations, in the same spirit as the
      // from/import/require patterns above. Optional modifier keywords are
      // skipped so the imported name itself is captured; for aliases the alias
      // name is captured, which is the name the code actually refers to.
      // Dotted names are kept whole because a trailing segment alone is
      // meaningless.
      /(?:global\s+)?using\s+(?:static\s+)?(?:namespace\s+)?([A-Za-z_][A-Za-z0-9_.]*)/,
      /import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /import\s*{\s*([^}]+)\s*}/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        // For module paths, just get the module name
        if (match[1].includes("/")) {
          const parts = match[1].split("/");
          return parts[parts.length - 1].replace(/\.(js|ts|jsx|tsx)$/, "");
        }
        return match[1].split(",")[0].trim(); // Take first import if multiple
      }
    }

    return null;
  }

  private static extractExportName(content: string): string | null {
    const patterns = [
      /export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /export\s*{\s*([^}]+)\s*}/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].split(",")[0].trim(); // Take first export if multiple
      }
    }

    return null;
  }

  private static extractVariableName(content: string): string | null {
    const patterns = [
      /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/,
      // Declarations whose name sits immediately before a braced body, such as
      // property accessors or struct definitions. Placed last so the
      // assignment and type-annotation patterns keep precedence.
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\{/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  private static extractModuleName(content: string): string | null {
    const patterns = [
      /(?:module|namespace)\s+([a-zA-Z_$][a-zA-Z0-9_$.]*)/,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  private static generateDirectoryOutput(
    node: DirectoryNode,
    lines: string[],
    depth: number
  ): void {
    const indent = "  ".repeat(depth);

    // Sort directories and files for consistent output
    const sortedDirs = Array.from(node.subdirectories.keys()).sort();
    const sortedFiles = Array.from(node.files.keys()).sort();

    // Output subdirectories first
    for (const dirName of sortedDirs) {
      lines.push(`${indent}${dirName}/`);
      const subNode = node.subdirectories.get(dirName)!;
      this.generateDirectoryOutput(subNode, lines, depth + 1);
    }

    // Output files in this directory
    for (const fileName of sortedFiles) {
      const symbols = node.files.get(fileName)!;
      const symbolStr = this.formatSymbols(symbols);

      if (symbolStr) {
        lines.push(`${indent}${fileName} ${symbolStr}`);
      } else {
        lines.push(`${indent}${fileName}`);
      }
    }
  }

  private static formatSymbols(symbols: CompactSymbol[]): string {
    if (symbols.length === 0) return "";

    // Organize symbols: group methods by class, separate standalone functions
    const classesWithMethods = new Map<string, ClassWithMethods>();
    const standaloneFunctions: string[] = [];
    const otherSymbols = new Map<string, string[]>();

    for (const symbol of symbols) {
      if (symbol.type === "cls") {
        // Initialize class entry
        if (!classesWithMethods.has(symbol.name)) {
          classesWithMethods.set(symbol.name, {
            name: symbol.name,
            methods: [],
            line: symbol.line,
          });
        }
      } else if (symbol.type === "fn") {
        if (symbol.parentClass) {
          // This is a method - add to the class
          if (!classesWithMethods.has(symbol.parentClass)) {
            classesWithMethods.set(symbol.parentClass, {
              name: symbol.parentClass,
              methods: [],
            });
          }
          classesWithMethods.get(symbol.parentClass)!.methods.push(symbol.name);
        } else {
          // Standalone function
          standaloneFunctions.push(symbol.name);
        }
      } else {
        // Other symbol types (imports, exports, variables, modules)
        if (!otherSymbols.has(symbol.type)) {
          otherSymbols.set(symbol.type, []);
        }
        otherSymbols.get(symbol.type)!.push(symbol.name);
      }
    }

    const parts: string[] = [];

    // Format classes with their methods
    if (classesWithMethods.size > 0) {
      const classEntries: string[] = [];
      for (const [className, classInfo] of classesWithMethods) {
        if (classInfo.methods.length > 0) {
          const uniqueMethods = [...new Set(classInfo.methods)];
          classEntries.push(`${className}(${uniqueMethods.join(",")})`);
        } else {
          classEntries.push(className);
        }
      }
      parts.push(`cls:${classEntries.join(",")}`);
    }

    // Format standalone functions
    if (standaloneFunctions.length > 0) {
      const uniqueFunctions = [...new Set(standaloneFunctions)];
      parts.push(`fn:${uniqueFunctions.join(",")}`);
    }

    // Format other symbol types in order
    const order: Array<"imp" | "exp" | "var" | "mod"> = [
      "imp",
      "exp",
      "var",
      "mod",
    ];
    for (const type of order) {
      const names = otherSymbols.get(type);
      if (names && names.length > 0) {
        const uniqueNames = [...new Set(names)];
        parts.push(`${type}:${uniqueNames.join(",")}`);
      }
    }

    return parts.join(" ");
  }

  private static generateStats(parsedFiles: ParsedFile[]): AnalysisStats {
    const stats: AnalysisStats = {
      totalFiles: parsedFiles.length,
      totalLines: 0,
      totalSize: 0,
      languageDistribution: {},
      largestFiles: [], // Not needed for compact format
    };

    parsedFiles.forEach((file) => {
      stats.totalLines += file.lineCount;
      stats.totalSize += file.fileInfo.size;

      // Files without an associated grammar have a null language; group them
      // under a generic label so they still appear in the distribution.
      const lang = file.fileInfo.language ?? "text";
      stats.languageDistribution[lang] =
        (stats.languageDistribution[lang] || 0) + 1;
    });

    return stats;
  }

  private static abbreviateLanguage(language: string): string {
    const abbreviations: Record<string, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      java: "java",
      kotlin: "kt",
      go: "go",
      rust: "rs",
      cpp: "cpp",
      c: "c",
      csharp: "cs",
      dart: "dart",
      swift: "swift",
    };

    return abbreviations[language] || language;
  }

  private static formatLines(lines: number): string {
    if (lines < 1000) return lines.toString();
    if (lines < 1000000) return `${(lines / 1000).toFixed(1)}k`;
    return `${(lines / 1000000).toFixed(1)}m`;
  }
}
