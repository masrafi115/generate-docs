#!/usr/bin/env node

/**
 * Universal Tree-Sitter Deep AST Documentation Generator Using Pure WASM Parsers
 * Supports: C, C++, PHP, Go, Python, Dart, Rust
 *
 * Captures structural declarations AND flow nodes:
 *   Classes, Structs, Functions, Methods, Namespaces, Imports
 *   + If/Else, Switch/Match, Loops (for/foreach/while/do/loop), Return, Throw
 *   + Leading comment blocks (line, block, doc comments)
 *
 * Outputs per-file Markdown with:
 *   - Nested bullet outline  (Nested Component Blueprint Tree View)
 *   - anyblock outline       (Structural Text Block View)
 *   - Mermaid LR flow diagram
 *
 * Requirements:
 *   npm install web-tree-sitter@0.20.8 tree-sitter-wasms glob
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { globSync } from 'glob';
import { createRequire } from 'module';
import { Parser, Language } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

// ─── Boot ─────────────────────────────────────────────────────────────────────

await Parser.init();

function resolveHome(filepath) {
    if (filepath.startsWith('~')) return path.join(os.homedir(), filepath.slice(1));
    return path.resolve(filepath);
}

const targetArg = process.argv[2];
const BASE_OUTPUT_DIR = targetArg
    ? resolveHome(targetArg)
    : path.join(process.cwd(), '.docs_output');

if (!fs.existsSync(BASE_OUTPUT_DIR)) fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });

const ROOT_DIR    = process.cwd();
const PROJECT_NAME = path.basename(ROOT_DIR);
const OBSIDIAN_VAULT_NAME = 'Codes Snippets Flashcards Diagrams';

// ─── Language config ──────────────────────────────────────────────────────────

const WASM_DIR = path.join(
    path.dirname(require.resolve('tree-sitter-wasms/package.json')),
    'out'
);

const LANGUAGE_WASM = {
    '.py':   'tree-sitter-python.wasm',
    '.go':   'tree-sitter-go.wasm',
    '.php':  'tree-sitter-php.wasm',
    '.c':    'tree-sitter-c.wasm',
    '.h':    'tree-sitter-c.wasm',
    '.cpp':  'tree-sitter-cpp.wasm',
    '.hpp':  'tree-sitter-cpp.wasm',
    '.rs':   'tree-sitter-rust.wasm',
    '.dart': 'tree-sitter-dart.wasm',
};

// ─── Node-type taxonomy ───────────────────────────────────────────────────────
//
// IMPORTANT: JS object literals silently drop duplicate keys — the last
// definition wins.  Every node type must appear exactly once.
//
// kind: 'struct' | 'exec' | 'directive' | 'flow_cond' | 'flow_loop'
//       | 'flow_exit' | 'comment'
//
// name strategies:
//   'field:<F>'       – childForFieldName('<F>').text
//   'child:<N>'       – child(N).text
//   'text:<N>'        – first N chars of raw node text
//   'condition'       – extract condition/value expression child
//   'return_val'      – first non-keyword child
//   'declarator_name' – C/C++ function declarator walk
//   'nested_func'     – Python decorated_definition → inner function name
//   'none'            – no name appended
//

const TAXONOMY = {
    // ── Python ──────────────────────────────────────────────────────────────
    class_definition:               { label: 'Class',          icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    function_definition:            { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    decorated_definition:           { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'nested_func' },
    // Python flow
    for_in_statement:               { label: 'For-In',         icon: '🔁',  kind: 'flow_loop', name: 'none' },  // Py for loop node
    raise_statement:                { label: 'Raise',          icon: '💥',  kind: 'flow_exit', name: 'return_val' },

    // ── Go ──────────────────────────────────────────────────────────────────
    function_declaration:           { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    method_declaration:             { label: 'Method',         icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    type_declaration:               { label: 'Type Decl',      icon: '🏛️',  kind: 'struct',    name: 'child:1' },
    package_clause:                 { label: 'Package',        icon: '📦',  kind: 'directive', name: 'child:1' },
    import_declaration:             { label: 'Import',         icon: '📥',  kind: 'directive', name: 'text:30' },
    expression_switch_statement:    { label: 'Switch',         icon: '🔀',  kind: 'flow_cond', name: 'condition' },
    type_switch_statement:          { label: 'Type Switch',    icon: '🔀',  kind: 'flow_cond', name: 'condition' },

    // ── PHP ─────────────────────────────────────────────────────────────────
    namespace_definition:           { label: 'Namespace',      icon: '🗂️',  kind: 'directive', name: 'child:1' },
    namespace_use_declaration:      { label: 'Use',            icon: '📥',  kind: 'directive', name: 'text:40' },
    class_declaration:              { label: 'Class',          icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    interface_declaration:          { label: 'Interface',      icon: '🔌',  kind: 'struct',    name: 'field:name' },
    trait_declaration:              { label: 'Trait',          icon: '🧩',  kind: 'struct',    name: 'field:name' },
    method_declaration:             { label: 'Method',         icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    // PHP-specific flow
    foreach_statement:              { label: 'Foreach',        icon: '🔁',  kind: 'flow_loop', name: 'none' },
    else_if_clause:                 { label: 'Elseif',         icon: '🌿',  kind: 'flow_cond', name: 'condition' },
    // PHP throw is an expression not a statement
    throw_expression:               { label: 'Throw',          icon: '💥',  kind: 'flow_exit', name: 'return_val' },

    // ── C ───────────────────────────────────────────────────────────────────
    struct_specifier:               { label: 'Struct',         icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    preproc_include:                { label: 'Include',        icon: '📥',  kind: 'directive', name: 'text:30' },

    // ── C++ ─────────────────────────────────────────────────────────────────
    class_specifier:                { label: 'Class',          icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    // namespace_definition already covered above (C++ shares the same node name)
    throw_statement:                { label: 'Throw',          icon: '💥',  kind: 'flow_exit', name: 'return_val' },
    for_range_loop:                 { label: 'For-Range',      icon: '🔁',  kind: 'flow_loop', name: 'none' },

    // ── Rust ────────────────────────────────────────────────────────────────
    struct_item:                    { label: 'Struct',         icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    enum_item:                      { label: 'Enum',           icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    union_item:                     { label: 'Union',          icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    impl_item:                      { label: 'Impl',           icon: '🔧',  kind: 'struct',    name: 'field:name' },
    trait_item:                     { label: 'Trait',          icon: '🧩',  kind: 'struct',    name: 'field:name' },
    function_item:                  { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    mod_item:                       { label: 'Module',         icon: '📦',  kind: 'directive', name: 'field:name' },
    use_declaration:                { label: 'Use',            icon: '📥',  kind: 'directive', name: 'text:30' },
    // Rust flow — note: return/throw are *expressions* in Rust
    for_expression:                 { label: 'For',            icon: '🔁',  kind: 'flow_loop', name: 'none' },
    while_expression:               { label: 'While',          icon: '🔁',  kind: 'flow_loop', name: 'condition' },
    loop_expression:                { label: 'Loop',           icon: '🔁',  kind: 'flow_loop', name: 'none' },
    if_expression:                  { label: 'If',             icon: '🌿',  kind: 'flow_cond', name: 'condition' },
    match_expression:               { label: 'Match',          icon: '🔀',  kind: 'flow_cond', name: 'condition' },
    return_expression:              { label: 'Return',         icon: '↩️',  kind: 'flow_exit', name: 'return_val' },
    // Rust doc comments
    line_comment:                   { label: 'Comment',        icon: '💬',  kind: 'comment',   name: 'text:60' },
    block_comment:                  { label: 'Comment',        icon: '📝',  kind: 'comment',   name: 'text:60' },
    doc_comment:                    { label: 'Doc Comment',    icon: '📝',  kind: 'comment',   name: 'text:60' },

    // ── Dart ────────────────────────────────────────────────────────────────
    // (class_definition already defined above under Python — same node name, same fields)
    mixin_declaration:              { label: 'Mixin',          icon: '🧩',  kind: 'struct',    name: 'field:name' },
    mixin_application_class:        { label: 'Mixin Class',    icon: '🏛️',  kind: 'struct',    name: 'child:0' },
    extension_declaration:          { label: 'Extension',      icon: '🔌',  kind: 'struct',    name: 'field:name' },
    extension_type_declaration:     { label: 'Extension Type', icon: '🔌',  kind: 'struct',    name: 'field:name' },
    enum_declaration:               { label: 'Enum',           icon: '🏛️',  kind: 'struct',    name: 'field:name' },
    function_signature:             { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'field:name' },
    constructor_signature:          { label: 'Constructor',    icon: '🔧',  kind: 'exec',      name: 'field:name' },
    factory_constructor_signature:  { label: 'Factory Ctor',   icon: '🔧',  kind: 'exec',      name: 'none' },
    library_import:                 { label: 'Import',         icon: '📥',  kind: 'directive', name: 'text:40' },
    library_export:                 { label: 'Export',         icon: '📤',  kind: 'directive', name: 'text:40' },
    library_name:                   { label: 'Library',        icon: '📦',  kind: 'directive', name: 'text:30' },
    // Dart flow — for_statement has no condition field, use 'none'
    for_statement:                  { label: 'For',            icon: '🔁',  kind: 'flow_loop', name: 'none' },
    switch_expression:              { label: 'Switch',         icon: '🔀',  kind: 'flow_cond', name: 'condition' },
    documentation_comment:          { label: 'Doc Comment',    icon: '📝',  kind: 'comment',   name: 'text:60' },

    // ── Shared across multiple languages (defined once) ──────────────────────
    // if/else — C, C++, Go, PHP, Python, Dart all use these exact node names
    if_statement:                   { label: 'If',             icon: '🌿',  kind: 'flow_cond', name: 'condition' },
    elif_clause:                    { label: 'Elif',           icon: '🌿',  kind: 'flow_cond', name: 'condition' },
    else_clause:                    { label: 'Else',           icon: '🌿',  kind: 'flow_cond', name: 'none' },
    switch_statement:               { label: 'Switch',         icon: '🔀',  kind: 'flow_cond', name: 'condition' },
    while_statement:                { label: 'While',          icon: '🔁',  kind: 'flow_loop', name: 'condition' },
    do_statement:                   { label: 'Do-While',       icon: '🔁',  kind: 'flow_loop', name: 'none' },
    return_statement:               { label: 'Return',         icon: '↩️',  kind: 'flow_exit', name: 'return_val' },
    // C / C++ function_definition (name via declarator walk; also covers Python — field:name used there instead)
    function_definition:            { label: 'Function',       icon: '⚙️',  kind: 'exec',      name: 'declarator_name' },
    // comment — C, C++, Go, PHP, Python, Dart all emit 'comment'
    comment:                        { label: 'Comment',        icon: '💬',  kind: 'comment',   name: 'text:60' },
};

// Nodes whose children we do NOT descend into
const OPAQUE_KINDS = new Set(['flow_exit']);

// Purely structural containers — descend transparently, never emit a line
const TRANSPARENT = new Set([
    'block', 'compound_statement', 'declaration_list', 'field_declaration_list',
    'translation_unit', 'source_file', 'program', 'module', 'body',
    'expression_statement', 'statement', 'statements',
    'class_body', 'enum_body', 'extension_body',  // Dart bodies
    'switch_block', 'switch_body',                  // PHP/Dart switch body wrappers
    'declaration',                                  // PHP bare declaration wrapper
]);

// ─── Name extraction helpers ──────────────────────────────────────────────────

const clean = (str) =>
    (str || '').replace(/["'\\]/g, '').replace(/\s+/g, ' ').trim();

const truncate = (str, n) => {
    const s = clean(str);
    return s.length > n ? s.slice(0, n - 3) + '...' : s;
};

function extractCondition(node) {
    // Prefer named 'condition' or 'value' field (Go switch uses 'value')
    for (const f of ['condition', 'value']) {
        const fn = node.childForFieldName?.(f);
        if (fn) return truncate(fn.text, 35);
    }
    // Fall back: first multi-token named child that isn't a keyword token
    const keywords = new Set(['if', 'elif', 'while', 'switch', 'match', 'for', 'foreach', '{', '(', ')', ';']);
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c.isNamed()) continue;
        if (keywords.has(c.text)) continue;
        return truncate(c.text, 35);
    }
    return '';
}

function extractReturnVal(node) {
    const keywords = new Set(['return', 'throw', 'raise', 'rethrow', ';']);
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c.isNamed() && keywords.has(c.text)) continue;
        if (c.isNamed()) return truncate(c.text, 30);
    }
    return '';
}

function getDeclaratorName(node) {
    // C/C++: function_definition has a declarator field containing
    // function_declarator(identifier + params) or pointer_declarator → …
    const decl = node.childForFieldName?.('declarator');
    if (decl) {
        // Walk through pointer indirections to find the function_declarator
        let cur = decl;
        while (cur && cur.type === 'pointer_declarator') {
            cur = cur.childForFieldName?.('declarator') || cur.child(0);
        }
        if (cur) {
            // The name sits before the '(' — just take the declarator child
            const inner = cur.childForFieldName?.('declarator') || cur.child(0);
            if (inner) return clean(inner.text.split('(')[0]);
        }
    }
    // Python function_definition also lands here — use field:name instead
    const nameField = node.childForFieldName?.('name');
    if (nameField) return clean(nameField.text);
    return truncate(node.text.split('(')[0], 30);
}

function getNestedFuncName(node) {
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === 'function_definition') {
            return c.childForFieldName?.('name')?.text || 'fn';
        }
    }
    return 'fn';
}

function extractName(node, strategy) {
    if (!strategy || strategy === 'none') return '';
    if (strategy.startsWith('field:')) {
        const field = strategy.slice(6);
        const n = node.childForFieldName?.(field);
        return n ? clean(n.text) : '';
    }
    if (strategy.startsWith('child:')) {
        const idx = parseInt(strategy.slice(6), 10);
        const c = node.child(idx);
        return c ? clean(c.text) : '';
    }
    if (strategy.startsWith('text:')) {
        return truncate(node.text, parseInt(strategy.slice(5), 10));
    }
    if (strategy === 'condition')      return extractCondition(node);
    if (strategy === 'return_val')     return extractReturnVal(node);
    if (strategy === 'declarator_name') return getDeclaratorName(node);
    if (strategy === 'nested_func')    return getNestedFuncName(node);
    return '';
}

// ─── Comment harvesting ───────────────────────────────────────────────────────
//
// Comments are sibling nodes. For each structural/flow node, collect the
// consecutive comment siblings that appear immediately before it.
//

function gatherLeadingComments(node) {
    const comments = [];
    const parent = node.parent;
    if (!parent) return comments;

    let idx = -1;
    for (let i = 0; i < parent.childCount; i++) {
        if (parent.child(i).id === node.id) { idx = i; break; }
    }
    if (idx <= 0) return comments;

    const commentTypes = new Set([
        'comment', 'line_comment', 'block_comment',
        'doc_comment', 'documentation_comment',
    ]);

    for (let i = idx - 1; i >= 0; i--) {
        const sib = parent.child(i);
        if (commentTypes.has(sib.type)) {
            comments.unshift(sib);
        } else if (sib.isNamed()) {
            // Non-comment named sibling — stop collecting
            break;
        }
        // Unnamed whitespace/punctuation — skip silently
    }
    return comments;
}

function formatCommentLabel(node) {
    let text = node.text || '';
    text = text
        .replace(/^\/\*+\s*|\s*\*+\/$/g, '')
        .replace(/^\/\/+\s*/gm, '')
        .replace(/^#+\s*/gm, '')
        .replace(/^\/\/\/\s*/gm, '');
    // Strip per-line leading asterisks (PHPDoc / JavaDoc style)
    text = text
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join(' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > 55 ? text.slice(0, 52) + '...' : text;
}

// ─── Mermaid helpers ──────────────────────────────────────────────────────────

const KIND_CSS = {
    struct:    'struct',
    exec:      'exec',
    directive: 'io',
    flow_cond: 'condition',
    flow_loop: 'loop',
    flow_exit: 'exit',
    comment:   'comment',
};

const KIND_SHAPE = {
    struct:    (id, lbl) => `${id}["${lbl}"]`,
    exec:      (id, lbl) => `${id}["${lbl}"]`,
    directive: (id, lbl) => `${id}>"${lbl}"]`,
    flow_cond: (id, lbl) => `${id}{"${lbl}"}`,
    flow_loop: (id, lbl) => `${id}(("${lbl}"))`,
    flow_exit: (id, lbl) => `${id}["${lbl}"]`,
    comment:   (id, lbl) => `${id}["${lbl}"]`,
};

// ─── Core walker ─────────────────────────────────────────────────────────────

function processFile(rootNode, relativePath, lang) {
    const outlineLines  = [];
    const mermaidLines  = [];
    let nodeCounter     = 0;
    const emittedCommentIds = new Set();

    const langIcon = {
        php: '🐘', rs: '🦀', py: '🐍', go: '🐹',
        dart: '🎯', c: '⚙️', cpp: '⚙️',
    }[lang] || '📄';

    mermaidLines.push(`graph LR`);
    mermaidLines.push(`    Root["${langIcon} ${relativePath}"]`);
    mermaidLines.push(`    classDef struct    fill:#1e3a5f,stroke:#3b82f6,stroke-width:2px,color:#fff;`);
    mermaidLines.push(`    classDef exec      fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#fff;`);
    mermaidLines.push(`    classDef io        fill:#115e59,stroke:#14b8a6,stroke-width:1px,color:#fff;`);
    mermaidLines.push(`    classDef condition fill:#6e251e,stroke:#e06c75,stroke-width:1px,color:#fff;`);
    mermaidLines.push(`    classDef loop      fill:#5c401b,stroke:#d19a66,stroke-width:1px,color:#fff;`);
    mermaidLines.push(`    classDef exit      fill:#374151,stroke:#9ca3af,stroke-width:1px,color:#fff;`);
    mermaidLines.push(`    classDef comment   fill:#2d2d2d,stroke:#6b7280,stroke-width:1px,color:#d1d5db,font-style:italic;`);
    mermaidLines.push(`    style Root fill:#1f6feb,stroke:#388bfd,stroke-width:2px,color:#fff`);

    const commentTypes = new Set([
        'comment', 'line_comment', 'block_comment',
        'doc_comment', 'documentation_comment',
    ]);

    function walk(node, depth, mermaidParentId) {
        const indent = '  '.repeat(depth);
        const tax    = TAXONOMY[node.type];

        // ── Transparent container ────────────────────────────────────────────
        if (!tax || TRANSPARENT.has(node.type)) {
            for (let i = 0; i < node.childCount; i++) {
                walk(node.child(i), depth, mermaidParentId);
            }
            return;
        }

        // ── Standalone comment node ──────────────────────────────────────────
        if (tax.kind === 'comment') {
            // Already emitted as a leading comment for a subsequent node — skip.
            if (emittedCommentIds.has(node.id)) return;
            emittedCommentIds.add(node.id);

            nodeCounter++;
            const cid     = `n${nodeCounter}`;
            const clabel  = formatCommentLabel(node);
            const cicon   = commentTypes.has(node.type) && node.type !== 'comment' ? '📝' : '💬';
            const display = `${cicon} ${clabel}`;

            outlineLines.push(`${indent}- [Comment] ${display}`);
            mermaidLines.push(`    ${mermaidParentId} --> ${cid}["${display.replace(/"/g, "'")}"]`);
            mermaidLines.push(`    class ${cid} comment;`);
            return;
        }

        // ── Gather leading comment siblings ──────────────────────────────────
        const leadingComments  = gatherLeadingComments(node);
        let   commentChainEnd  = mermaidParentId;

        for (const c of leadingComments) {
            if (emittedCommentIds.has(c.id)) continue;
            emittedCommentIds.add(c.id);

            nodeCounter++;
            const cid     = `n${nodeCounter}`;
            const clabel  = formatCommentLabel(c);
            const cicon   = c.type !== 'comment' ? '📝' : '💬';
            const display = `${cicon} ${clabel}`;

            outlineLines.push(`${indent}- [Comment] ${display}`);
            mermaidLines.push(
                `    ${commentChainEnd} -. "${display.replace(/"/g, "'")}" .-> ${cid}["${display.replace(/"/g, "'")}"]`
            );
            mermaidLines.push(`    class ${cid} comment;`);
            commentChainEnd = cid;
        }

        // ── Emit this node ───────────────────────────────────────────────────
        nodeCounter++;
        const nid        = `n${nodeCounter}`;
        const rawName    = extractName(node, tax.name);
        const display    = rawName
            ? `${tax.icon} ${tax.label}: ${rawName}`
            : `${tax.icon} ${tax.label}`;
        const mermaidLbl = display.replace(/"/g, "'");

        outlineLines.push(`${indent}- [${tax.label}] ${display}`);

        const shape    = (KIND_SHAPE[tax.kind] || KIND_SHAPE.exec)(nid, mermaidLbl);
        const cssClass = KIND_CSS[tax.kind] || 'exec';
        mermaidLines.push(`    ${commentChainEnd} --> ${shape}`);
        mermaidLines.push(`    class ${nid} ${cssClass};`);

        // ── Recurse into children (unless opaque) ────────────────────────────
        if (!OPAQUE_KINDS.has(tax.kind)) {
            for (let i = 0; i < node.childCount; i++) {
                walk(node.child(i), depth + 1, nid);
            }
        }
    }

    for (let i = 0; i < rootNode.childCount; i++) {
        walk(rootNode.child(i), 0, 'Root');
    }

    return {
        outlineLines,
        mermaidCode: mermaidLines.join('\n'),
    };
}

// ─── File discovery & processing ──────────────────────────────────────────────

const files = globSync('**/*.{c,cpp,h,hpp,php,go,py,dart,rs}', {
    ignore: [
        'node_modules/**', 'dist/**', 'build/**', '.dart_tool/**',
        '.docs_output/**', 'venv/**', '.git/**', 'target/**',
    ],
});

if (files.length === 0) {
    console.log('❌ No valid source files found.');
    process.exit(0);
}

console.log(`🤖 Tree-sitter deep AST parser initialising for [${PROJECT_NAME}]...`);
console.log(`   Found ${files.length} source file(s)\n`);

const loadedLanguages = {};
const fileOutlines    = {};
const fileDiagrams    = {};

for (const file of files) {
    const absolutePath = path.resolve(file).replace(/\\/g, '/');
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const ext          = path.extname(file).toLowerCase();
    const wasmFile     = LANGUAGE_WASM[ext];
    if (!wasmFile) continue;

    try {
        if (!loadedLanguages[wasmFile]) {
            const wasmPath = path.join(WASM_DIR, wasmFile);
            loadedLanguages[wasmFile] = await Language.load(wasmPath);
        }
        const parser = new Parser();
        parser.setLanguage(loadedLanguages[wasmFile]);

        const code = fs.readFileSync(absolutePath, 'utf-8');
        const tree = parser.parse(code);
        const lang = ext.slice(1);

        const { outlineLines, mermaidCode } = processFile(tree.rootNode, relativePath, lang);

        const outlineText = outlineLines.join('\n') || '*No trackable structures found.*';
        fileOutlines[relativePath] = outlineText;
        fileDiagrams[relativePath] = mermaidCode;

        // ── Per-file Markdown ──────────────────────────────────────────────

        const encodedVault    = encodeURIComponent(OBSIDIAN_VAULT_NAME);
        const obsidianEscaped = `temp/` + absolutePath.replace(/\//g, '-s-') + '.md';
        const encodedObs      = encodeURIComponent(obsidianEscaped);
        const obsidianUri     = `obsidian://open?vault=${encodedVault}&file=${encodedObs}`;
        const fileUri         = `file://${absolutePath}`;
        const vscodeUri       = `vscode://file/${absolutePath}`;

        const markdownWrapper = `---
project: "${PROJECT_NAME}"
original_path: ${absolutePath}
file_uri: ${fileUri}
vscode_uri: ${vscodeUri}
obsidian_uri: ${obsidianUri}
language: ${lang}
---

# Deep AST Flow Map: ${relativePath}

### Target Information Metrics
* **Project Reference:** \`${PROJECT_NAME}\`
* **Language:** \`${lang.toUpperCase()}\`
* **Local System Reference:** \`${absolutePath}\`

---

## Nested Component Blueprint Tree View

${outlineText}

---

## Structural Text Block View

\`\`\`anyblock
[list2node]
${outlineText}
\`\`\`

---

## Component Execution Structural Flow

\`\`\`mermaid
${mermaidCode}
\`\`\`
`;

        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');
        console.log(`  ✔ ${relativePath}`);

    } catch (err) {
        console.error(`  ❌ ${relativePath}: ${err.message}`);
    }
}

// ─── Master DOC.md ────────────────────────────────────────────────────────────

let masterContent = `# Multi-Language Deep AST Catalog — ${PROJECT_NAME}\n\n## Polyglot Project Workspace Module Map\n\n`;

for (const relativePath of Object.keys(fileOutlines)) {
    const safeFileName    = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
    const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
    const componentMdUri  = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

    masterContent +=
        `### 📄 \`${relativePath}\`\n` +
        `* [Open Isolated Module Map](${componentMdUri})\n\n` +
        `#### Structural + Flow Outline\n${fileOutlines[relativePath]}\n\n` +
        `\`\`\`anyblock\n[list2node]\n${fileOutlines[relativePath]}\n\`\`\`\n\n` +
        `\`\`\`mermaid\n${fileDiagrams[relativePath]}\n\`\`\`\n\n---\n\n`;
}

masterContent += `*Generated automatically on ${new Date().toLocaleString()}*\n`;

fs.writeFileSync(path.join(BASE_OUTPUT_DIR, 'DOC.md'), masterContent, 'utf-8');

console.log('\n========= DEEP AST PARSE COMPLETE =========');
console.log(`✔ ${Object.keys(fileOutlines).length} modules mapped`);
console.log(`✔ Output → ${BASE_OUTPUT_DIR}`);
console.log(`✔ Master index → ${path.join(BASE_OUTPUT_DIR, 'DOC.md')}`);
console.log('===========================================');
