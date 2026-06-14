import type { Node } from "web-tree-sitter";

export class TreeWalker {
  /**
   * Extract summary using Tree-sitter's built-in capabilities
   */
  extractSummary(rootNode: Node, sourceCode: string): string {
    const sections: string[] = [];

    // Extract key structural elements using simple node traversal
    const structuralInfo = this.extractStructuralInfo(rootNode, sourceCode);

    // Format the summary - ONLY structural elements, no syntax tree
    if (structuralInfo.length > 0) {
      sections.push("=== STRUCTURAL ELEMENTS ===");
      structuralInfo.forEach((info) => sections.push(info));
    } else {
      sections.push("No significant structures found");
    }

    return sections.join("\n");
  }

  /**
   * Extract key structural information by walking the tree
   */
  private extractStructuralInfo(node: Node, sourceCode: string): string[] {
    const info: string[] = [];

    // Use Tree-sitter's built-in node information
    this.walkForStructures(node, sourceCode, info, 0);

    return info;
  }

  /**
   * Walk the tree and collect structural information
   */
  private walkForStructures(
    node: Node,
    sourceCode: string,
    info: string[],
    depth: number
  ): void {
    // Process more levels but limit very deep nesting
    if (depth > 4) return;

    const nodeType = node.type;
    const startLine = node.startPosition.row + 1;
    const indent = "  ".repeat(Math.min(depth, 3)); // Limit visual indentation

    // Extract based on structural node types
    if (this.isStructuralNode(nodeType)) {
      const nodeText = this.getNodeSignature(node, sourceCode);

      // Skip very generic or empty nodes
      if (
        nodeText.trim() &&
        nodeText.length > 1 &&
        !this.isGenericNode(nodeType)
      ) {
        info.push(`${indent}${nodeType}: ${nodeText} (line ${startLine})`);
      }
    }

    // Recursively process children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.walkForStructures(child, sourceCode, info, depth + 1);
      }
    }
  }

  /**
   * Check if a node is too generic to be useful
   */
  private isGenericNode(nodeType: string): boolean {
    const genericTypes = [
      "program",
      "source_file",
      "block",
      "statement_block",
      "compound_statement",
      "expression_statement",
      "assignment_expression",
      "identifier",
      "string",
      "number",
      "boolean",
      "null",
      "undefined",
      "comment",
    ];

    return genericTypes.includes(nodeType);
  }

  /**
   * Check if a node type represents a structural element
   */
  private isStructuralNode(nodeType: string): boolean {
    // Be more inclusive - if it looks like a structural element, include it
    const structuralPatterns = [
      // Function patterns
      "function",
      "method",
      "constructor",
      "procedure",
      "subroutine",

      // Class/Type patterns
      "class",
      "interface",
      "struct",
      "trait",
      "enum",
      "union",

      // Import/Export patterns
      "import",
      "export",
      "use",
      "include",
      "require",

      // Declaration patterns
      "declaration",
      "definition",
      "statement",

      // Module patterns
      "module",
      "namespace",
      "package",
    ];

    // Check if the node type contains any structural patterns
    const lowerNodeType = nodeType.toLowerCase();
    const isStructural = structuralPatterns.some((pattern) =>
      lowerNodeType.includes(pattern)
    );

    // Also include some specific high-value node types
    const explicitTypes = [
      // JavaScript/TypeScript
      "variable_declarator",
      "lexical_declaration",
      "expression_statement",
      "assignment_expression",
      "call_expression",

      // Python
      "assignment",
      "expression_statement",
      "call",

      // Java
      "local_variable_declaration",
      "field_declaration",

      // Go
      "var_declaration",
      "short_var_declaration",
      "type_spec",

      // Rust
      "let_declaration",
      "item",
      "use_declaration",

      // C/C++
      "declaration",
      "function_declarator",
      "init_declarator",
    ];

    return isStructural || explicitTypes.includes(nodeType);
  }

  /**
   * Get a clean signature for a node
   */
  private getNodeSignature(node: Node, sourceCode: string): string {
    // For most nodes, we want just the first line or a clean summary
    const fullText = sourceCode.slice(node.startIndex, node.endIndex);

    // Get the first meaningful line
    const firstLine = fullText.split("\n")[0].trim();

    // If it's too long, truncate it intelligently
    if (firstLine.length > 100) {
      // For functions, try to get just the signature
      if (firstLine.includes("(") && firstLine.includes(")")) {
        const signatureEnd = firstLine.indexOf(")") + 1;
        return firstLine.substring(0, signatureEnd) + " { ... }";
      }

      // For other constructs, just truncate
      return firstLine.substring(0, 97) + "...";
    }

    return firstLine;
  }
}
