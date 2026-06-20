#!/usr/bin/env node

/**
 * Universal Node-Native Tree-Sitter AST Documentation & Outline Parser
 * Supports: C, C++, PHP, Go, Python, Dart, and Rust
 *
 * All languages go through a single tree-sitter pipeline — no secondary
 * frameworks. Each grammar package has its own export shape; the
 * resolveLanguage() helper normalises them all before they touch the parser.
 *
 * Grammar packages and their quirks:
 *   tree-sitter-c       – ESM default export  → need .default
 *   tree-sitter-cpp     – CJS, binding IS the lang object (no sub-key)
 *   tree-sitter-php     – CJS, exposes { php, php_only } → use .php
 *   tree-sitter-go      – CJS, binding IS the lang object
 *   tree-sitter-python  – CJS, binding IS the lang object
 *   tree-sitter-rust    – CJS, binding IS the lang object
 *   @driftlog/tree-sitter-dart – CJS, binding IS the lang object
 *
 * Install all grammars:
 *   npm install tree-sitter tree-sitter-c tree-sitter-cpp tree-sitter-php \
 *               tree-sitter-go tree-sitter-python tree-sitter-rust \
 *               @driftlog/tree-sitter-dart
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
    if (filepath.startsWith('~')) {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return path.resolve(filepath);
}

/**
 * Normalise the raw module export from a grammar package into the plain
 * language object that `parser.setLanguage()` expects.
 *
 * Rules applied in order:
 *  1. If the export has a `.php` property  → tree-sitter-php  shape → use it
 *  2. If the export has a `.default`        → ESM-in-CJS shape    → use it
 *  3. Otherwise the export IS the language object already
 */
function resolveLanguage(raw, pkgName) {
    if (raw && typeof raw === 'object' && raw.php) {
        // tree-sitter-php: { php: <lang>, php_only: <lang> }
        return raw.php;
    }
    if (raw && typeof raw === 'object' && typeof raw.default !== 'undefined') {
        // tree-sitter-c (ESM default re-exported into CJS): { default: <lang> }
        return raw.default;
    }
    // tree-sitter-cpp, go, python, rust, dart — binding IS the language
    return raw;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const targetArg    = process.argv[2];
let BASE_OUTPUT_DIR = targetArg
    ? resolveHome(targetArg)
    : path.join(process.cwd(), '.docs_output');

if (!fs.existsSync(BASE_OUTPUT_DIR)) {
    fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
}

const ROOT_DIR    = process.cwd();
const PROJECT_NAME = path.basename(ROOT_DIR);
const OBSIDIAN_VAULT_NAME = "Codes Snippets Flashcards Diagrams";

const files = globSync('**/*.{c,cpp,h,hpp,php,go,py,dart,rs}', {
    ignore: [
        'node_modules/**', 'dist/**', 'build/**',
        '.dart_tool/**', '.docs_output/**',
        'venv/**', '.git/**', 'target/**',
    ],
});

if (files.length === 0) {
    console.log('❌ No valid source file targets discovered.');
    process.exit(0);
}

/**
 * Map each file extension to its npm grammar package name.
 * @driftlog/tree-sitter-dart is the community package with correct peer-dep
 * range for tree-sitter >=0.22 and working prebuilds.
 */
const LANGUAGE_PACKAGES = {
    '.c'  : 'tree-sitter-c',
    '.h'  : 'tree-sitter-c',
    '.cpp': 'tree-sitter-cpp',
    '.hpp': 'tree-sitter-cpp',
    '.php': 'tree-sitter-php',
    '.go' : 'tree-sitter-go',
    '.py' : 'tree-sitter-python',
    '.rs' : 'tree-sitter-rust',
    '.dart': '@driftlog/tree-sitter-dart',
};

// ---------------------------------------------------------------------------
// Node-type → human label mapping
// ---------------------------------------------------------------------------

function getStructuralLabel(nodeType) {
    const type = nodeType.toLowerCase();

    if ([
        // C / C++
        'struct_specifier', 'type_declaration',
        // PHP / Go / generic OOP
        'class_declaration', 'interface_declaration', 'trait_declaration',
        // Python
        'class_definition',
        // Rust
        'struct_item', 'enum_item', 'union_item', 'impl_item', 'trait_item',
        // Dart
        'class_definition_extends', 'mixin_declaration',
        'extension_declaration', 'enum_declaration',
    ].includes(type)) {
        return type === 'impl_item' ? 'Implementation' : 'Class/Struct/Trait';
    }

    if ([
        // C / C++ / Go
        'function_definition', 'function_declaration',
        // PHP / JS-like
        'method_declaration', 'method_definition',
        // Python
        'function_definition',
        // Rust
        'function_item',
        // Dart
        'function_signature', 'method_signature',
    ].includes(type)) {
        return 'Routine';
    }

    if ([
        // Go / C
        'package_clause', 'preproc_include',
        // PHP
        'namespace_definition', 'include_statement',
        // Rust
        'mod_item', 'use_declaration',
        // Dart
        'import_specification', 'library_name',
    ].includes(type)) {
        return 'Directive/Module';
    }

    return null;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

function runPipeline() {
    const parser = new Parser();

    console.log(`🤖 Initialising native AST mapping engines for [${PROJECT_NAME}]...`);

    // Cache resolved language objects so each grammar is loaded only once.
    const languageCache = {};

    const fileOutlines = {};

    for (const file of files) {
        const absolutePath = path.resolve(file).replace(/\\/g, '/');
        const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
        const ext          = path.extname(file).toLowerCase();

        const pkgName = LANGUAGE_PACKAGES[ext];
        if (!pkgName) continue;

        try {
            // ------------------------------------------------------------------
            // 1. Load + normalise the grammar (cached per package name)
            // ------------------------------------------------------------------
            if (!languageCache[pkgName]) {
                let raw;
                try {
                    raw = require(pkgName);
                } catch {
                    // Fallback: resolve relative to the project's node_modules
                    const fallback = path.join(ROOT_DIR, 'node_modules', pkgName);
                    raw = require(fallback);
                }
                languageCache[pkgName] = resolveLanguage(raw, pkgName);
            }

            parser.setLanguage(languageCache[pkgName]);

            // ------------------------------------------------------------------
            // 2. Parse the file
            // ------------------------------------------------------------------
            const rawCode = fs.readFileSync(absolutePath, 'utf-8');
            const tree    = parser.parse(rawCode);

            // ------------------------------------------------------------------
            // 3. Walk the AST and collect outline lines
            // ------------------------------------------------------------------
            const outlineLines = [];

            function walk(node, level = 0) {
                const indent = '  '.repeat(level);
                const label  = getStructuralLabel(node.type);
                let nextLevel = level;

                if (label) {
                    const nameNode =
                        node.childForFieldName('name') ||
                        node.childForFieldName('bounds') ||
                        node.child(1);

                    let actualName = nameNode
                        ? nameNode.text.split('\n')[0]
                        : node.type;

                    // Strip anything from the first brace onward (e.g. generic params)
                    actualName = actualName.split('{')[0].trim();

                    outlineLines.push(`${indent}- [${label}] ${actualName}`);
                    nextLevel = level + 1;
                }

                for (let i = 0; i < node.childCount; i++) {
                    walk(node.child(i), nextLevel);
                }
            }

            walk(tree.rootNode, 0);

            // ------------------------------------------------------------------
            // 4. Write per-file markdown document
            // ------------------------------------------------------------------
            const markdownOutline = outlineLines.join('\n');
            fileOutlines[relativePath] = markdownOutline;

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

# Native AST Layout Tree: ${relativePath}

## Nested Component Blueprint Tree View

${markdownOutline || '*No trackable structures found inside this module.*'}

## Structural Text Block View

\`\`\`anyblock
[list2node]
${markdownOutline || '*No trackable structures found inside this module.*'}
\`\`\`
`;

            const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
            fs.writeFileSync(
                path.join(BASE_OUTPUT_DIR, safeFileName),
                markdownWrapper,
                'utf-8',
            );

        } catch (err) {
            console.error(`❌ Parse failed [${relativePath}]: ${err.message}`);
        }
    }

    // --------------------------------------------------------------------------
    // 5. Write master index document
    // --------------------------------------------------------------------------
    let masterContent =
        `# Multi-Language Structural Catalog Blueprint Index\n\n` +
        `## Polyglot Project Workspace Module Map\n`;

    for (const relativePath of Object.keys(fileOutlines)) {
        const safeFileName    = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
        const componentMdUri  = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

        const cleanBlockLines = fileOutlines[relativePath]
            ? fileOutlines[relativePath]
                .split('\n')
                .map(line => line.replace(/^(\s*)-\s*/, '$1'))
                .join('\n')
            : '// Empty Module Schema';

        masterContent +=
            `\n### 📄 Module Summary Mapping: \`${relativePath}\`\n` +
            `* [Open Workspace View](${componentMdUri})\n\n` +
            `#### Structural Architecture Profile\n` +
            `${fileOutlines[relativePath] || '  * *Empty Module Details*'}\n\n` +
            `\`\`\`outline\n${cleanBlockLines}\n\`\`\`\n\n---\n`;
    }

    fs.writeFileSync(path.join(BASE_OUTPUT_DIR, 'DOC.md'), masterContent, 'utf-8');

    console.log('\n========= NODE-NATIVE AST GENERATOR COMPLETE =========');
    console.log('✔ Processed: C, C++, PHP, Go, Python, Dart, Rust  (tree-sitter only)');
}

runPipeline();
