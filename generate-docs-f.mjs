#!/usr/bin/env node

/**
 * Generate Outline for Flutter/Dart — Tree-Sitter AST Parser
 *
 * Replaces the hand-rolled JS lexer with native tree-sitter bindings.
 * Grammar: @driftlog/tree-sitter-dart  (peer: tree-sitter >=0.22)
 *
 * Install:
 *   npm install tree-sitter @driftlog/tree-sitter-dart glob
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { globSync }    from 'glob';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Parser  = require('tree-sitter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveHome(filepath) {
    if (filepath.startsWith('~')) return path.join(os.homedir(), filepath.slice(1));
    return path.resolve(filepath);
}

// @driftlog/tree-sitter-dart exports the binding directly (no sub-property needed)
function loadDartLanguage() {
    try {
        return require('@driftlog/tree-sitter-dart');
    } catch {
        const fallback = path.join(process.cwd(), 'node_modules', '@driftlog', 'tree-sitter-dart');
        return require(fallback);
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const targetArg     = process.argv[2];
const BASE_OUTPUT_DIR = targetArg
    ? resolveHome(targetArg)
    : path.join(process.cwd(), '.docs_output');

if (!fs.existsSync(BASE_OUTPUT_DIR)) fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });

const ROOT_DIR    = process.cwd();
const PROJECT_NAME = path.basename(ROOT_DIR);
const OBSIDIAN_VAULT_NAME = "Codes Snippets Flashcards Diagrams";

const files = globSync('**/*.dart', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.dart_tool/**', '.docs_output/**'],
});

if (files.length === 0) {
    console.log('❌ No Dart targets found.');
    process.exit(0);
}

// ---------------------------------------------------------------------------
// AST label mapping
//
// Node types sourced from @driftlog/tree-sitter-dart src/node-types.json.
// Only the structurally meaningful named nodes are mapped; everything else
// is traversed silently so we don't miss nested declarations.
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label for a tree-sitter node type, or null if
 * the node should be traversed without emitting an outline entry.
 *
 * @param {string} nodeType  - node.type from the tree-sitter AST
 * @returns {{ label: string, kind: string } | null}
 */
function classifyNode(nodeType) {
    switch (nodeType) {
        // ── Types / Classes ───────────────────────────────────────────────
        case 'class_definition':
            return { label: 'Class',           kind: 'type' };
        case 'mixin_declaration':
            return { label: 'Mixin',           kind: 'type' };
        case 'mixin_application_class':
            return { label: 'Mixin Class',     kind: 'type' };
        case 'extension_declaration':
            return { label: 'Extension',       kind: 'type' };
        case 'extension_type_declaration':
            return { label: 'Extension Type',  kind: 'type' };
        case 'enum_declaration':
            return { label: 'Enum',            kind: 'type' };

        // ── Functions / Methods ───────────────────────────────────────────
        case 'function_signature':
            return { label: 'Function',        kind: 'routine' };
        case 'getter_signature':
            return { label: 'Getter',          kind: 'routine' };
        case 'setter_signature':
            return { label: 'Setter',          kind: 'routine' };
        case 'operator_signature':
            return { label: 'Operator',        kind: 'routine' };
        case 'local_function_declaration':
            return { label: 'Local Function',  kind: 'routine' };

        // ── Constructors ──────────────────────────────────────────────────
        case 'constructor_signature':
            return { label: 'Constructor',               kind: 'constructor' };
        case 'constant_constructor_signature':
            return { label: 'Const Constructor',         kind: 'constructor' };
        case 'factory_constructor_signature':
            return { label: 'Factory Constructor',       kind: 'constructor' };
        case 'redirecting_factory_constructor_signature':
            return { label: 'Redirecting Constructor',   kind: 'constructor' };

        // ── Fields / Variables ────────────────────────────────────────────
        case 'initialized_variable_definition':
            return { label: 'Variable',        kind: 'field' };
        case 'static_final_declaration':
            return { label: 'Static Final',    kind: 'field' };

        // ── Directives ────────────────────────────────────────────────────
        case 'library_import':
        case 'import_specification':
            return { label: 'Import',          kind: 'directive' };
        case 'library_export':
            return { label: 'Export',          kind: 'directive' };
        case 'library_name':
            return { label: 'Library',         kind: 'directive' };

        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Name extraction
//
// Each node type exposes its identifier differently.  We try the most
// specific field first, then fall back to scanning immediate children for
// an `identifier` node, then to the raw source text.
// ---------------------------------------------------------------------------

/**
 * Extract a display name string from a tree-sitter node.
 *
 * @param {object} node  - tree-sitter SyntaxNode
 * @returns {string}
 */
function extractName(node) {
    // 1. Try the `name` field — present on class_definition, enum_declaration,
    //    extension_declaration, extension_type_declaration, constructor_signature,
    //    function_signature, getter_signature, setter_signature.
    const nameField = node.childForFieldName('name');
    if (nameField) return nameField.text.trim();

    // 2. For library_import / library_export there is no `name` field; pull
    //    the URI from the first child of type `import_specification` or the
    //    raw string literal child.
    if (node.type === 'library_import') {
        const spec = [...Array(node.childCount).keys()]
            .map(i => node.child(i))
            .find(c => c.type === 'import_specification');
        if (spec) {
            const uri = [...Array(spec.childCount).keys()]
                .map(i => spec.child(i))
                .find(c => c.type === 'uri' || c.type === 'configurable_uri' || c.type === 'string_literal');
            if (uri) return uri.text.replace(/['"]/g, '');
        }
    }

    if (node.type === 'library_export') {
        const uri = [...Array(node.childCount).keys()]
            .map(i => node.child(i))
            .find(c => c.type === 'configurable_uri' || c.type === 'string_literal');
        if (uri) return uri.text.replace(/['"]/g, '');
    }

    // 3. Scan immediate children for any `identifier` node.
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === 'identifier' || c.type === 'type_identifier') {
            return c.text.trim();
        }
    }

    // 4. Last resort: first line of raw source, trimmed of braces/semicolons.
    return node.text.split('\n')[0].split('{')[0].split(';')[0].trim().slice(0, 80);
}

// ---------------------------------------------------------------------------
// Return-type extraction  (best-effort for functions / getters / setters)
// ---------------------------------------------------------------------------

/**
 * Try to find the declared return type of a routine node.
 * Returns an empty string when none is determinable.
 *
 * @param {object} node - tree-sitter SyntaxNode
 * @returns {string}
 */
function extractReturnType(node) {
    const typeKinds = new Set([
        'type_identifier', 'nullable_type', 'void_type',
        'function_type', 'record_type', 'inferred_type',
    ]);
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (typeKinds.has(c.type)) return c.text.trim();
    }
    return '';
}

// ---------------------------------------------------------------------------
// Parameter list extraction
// ---------------------------------------------------------------------------

/**
 * Pull the raw text of the formal_parameter_list child, if present.
 *
 * @param {object} node - tree-sitter SyntaxNode
 * @returns {string}  e.g. "(int a, String b)"
 */
function extractParams(node) {
    // Use the `parameters` field when available (constructor_signature)
    const paramsField = node.childForFieldName('parameters');
    if (paramsField) return paramsField.text.trim();

    // Otherwise look for formal_parameter_list among direct children
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === 'formal_parameter_list') return c.text.trim();
    }
    return '';
}

// ---------------------------------------------------------------------------
// AST walker — produces outline lines
// ---------------------------------------------------------------------------

/**
 * Recursively walk a tree-sitter subtree, emitting indented outline lines
 * for every classified node.
 *
 * Nodes that are classified get an entry and their children are walked at
 * the next indentation level.  Unclassified nodes are walked transparently
 * at the same level so no nested declarations are missed.
 *
 * @param {object}   node        - tree-sitter SyntaxNode
 * @param {number}   level       - current indentation depth
 * @param {string[]} lines       - accumulator array (mutated in-place)
 */
function walk(node, level, lines) {
    const info = classifyNode(node.type);

    if (info) {
        const indent = '  '.repeat(level);
        const name   = extractName(node);

        let suffix = '';
        if (info.kind === 'routine') {
            const ret    = extractReturnType(node);
            const params = extractParams(node);
            if (ret)    suffix += ` [Returns: ${ret}]`;
            if (params) suffix += ` [Params: ${params}]`;
        } else if (info.kind === 'constructor') {
            const params = extractParams(node);
            if (params) suffix += ` [Params: ${params}]`;
        } else if (info.kind === 'field') {
            // For variables/statics show the type identifier if present
            const typeKinds = new Set(['type_identifier', 'nullable_type', 'void_type', 'inferred_type']);
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i);
                if (typeKinds.has(c.type)) { suffix = ` [Type: ${c.text.trim()}]`; break; }
            }
        }

        lines.push(`${indent}- ${name} [${info.label}]${suffix}`);

        // Walk children one level deeper
        for (let i = 0; i < node.childCount; i++) {
            walk(node.child(i), level + 1, lines);
        }
    } else {
        // Transparent traversal — same indentation level
        for (let i = 0; i < node.childCount; i++) {
            walk(node.child(i), level, lines);
        }
    }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

function runPipeline() {
    const parser = new Parser();
    parser.setLanguage(loadDartLanguage());

    console.log(`Analysing Dart codebase for [${PROJECT_NAME}]...`);

    const fileOutlines = {};

    for (const file of files) {
        const absolutePath = path.resolve(file).replace(/\\/g, '/');
        const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');

        try {
            const rawCode = fs.readFileSync(absolutePath, 'utf-8');
            const tree    = parser.parse(rawCode);

            const outlineLines = [];
            walk(tree.rootNode, 0, outlineLines);

            const markdownOutline = outlineLines.join('\n');
            fileOutlines[relativePath] = markdownOutline;

            const blockOutline = outlineLines
                .map(line => line.replace(/^(\s*)-\s*/, '$1'))
                .join('\n');

            const encodedVault       = encodeURIComponent(OBSIDIAN_VAULT_NAME);
            const obsidianEscapedPath = `temp/` + absolutePath.replace(/\//g, '-s-') + '.md';
            const encodedObsidianPath = encodeURIComponent(obsidianEscapedPath);

            const obsidianUri = `obsidian://open?vault=${encodedVault}&file=${encodedObsidianPath}`;
            const fileUri     = `file://${absolutePath}`;
            const vscodeUri   = `vscode://file/${absolutePath}`;

            const markdownWrapper = `---
project: "${PROJECT_NAME}"
original_path: ${absolutePath}
file_uri: ${fileUri}
vscode_uri: ${vscodeUri}
obsidian_uri: ${obsidianUri}
---

# Dart Codebase Outline: ${relativePath}

### File Architecture Metadata
* **Project Target:** \`${PROJECT_NAME}\`
* **Local System Path:** \`${absolutePath}\`

## Nested Component Blueprint Tree View

${markdownOutline || '*No trackable Class structures, Methods or Widget layouts found inside this module.*'}

## Structural Block View

\`\`\`anyblock
[list2node]
${markdownOutline || '// Empty Module Scheme'}
\`\`\`
`;

            const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
            fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

        } catch (err) {
            console.error(`❌ Parse failed [${relativePath}]: ${err.message}`);
        }
    }

    // ── Master index ────────────────────────────────────────────────────────
    let masterContent = `# Project Dart Blueprint Structural Catalog Index\n\n---\n\n## Workspace Dart Module Map Matrix\n`;

    for (const relativePath of Object.keys(fileOutlines)) {
        const safeFileName    = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
        const componentMdUri  = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

        const cleanBlockLines = fileOutlines[relativePath]
            ? fileOutlines[relativePath].split('\n').map(l => l.replace(/^(\s*)-\s*/, '$1')).join('\n')
            : '// Empty Module Scheme';

        masterContent +=
            `\n### 📄 Module Summary Mapping: \`${relativePath}\`\n` +
            `* **Isolated Tree Document Matrix:** [Open Target File Workspace View](${componentMdUri})\n\n` +
            `#### Dart Module Structural Architecture Profile\n` +
            `${fileOutlines[relativePath] || '  * *Empty Module Core Details*'}\n\n` +
            `#### Core Blueprint Structure Custom Block Preview\n` +
            `\`\`\`anyblock\n[list2node]\n${cleanBlockLines}\n\`\`\`\n\n---\n`;
    }

    masterContent += `\n*Generated automatically on ${new Date().toLocaleString()}*`;

    const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
    fs.writeFileSync(docMdPath, masterContent, 'utf-8');

    console.log('\n========= TREE-SITTER DART AST GENERATOR COMPLETE =========');
    console.log(`✔ Isolated Structural Modules Mapped   -> ${Object.keys(fileOutlines).length} files parsed`);
    console.log(`✔ Master Catalog Documentation Doc  -> ${docMdPath}`);
    console.log('============================================================');
}

runPipeline();
