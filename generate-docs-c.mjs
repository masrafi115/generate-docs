#!/usr/bin/env node

/**
 * Universal Node-Native Tree-Sitter AST Documentation & Outline Parser
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import { createRequire } from 'module';

// Use createRequire to load native C++ node bindings cleanly
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');

function resolveHome(filepath) {
    if (filepath.startsWith('~')) {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return path.resolve(filepath);
}

const targetArg = process.argv[2];
let BASE_OUTPUT_DIR = targetArg ? resolveHome(targetArg) : path.join(process.cwd(), '.docs_output');

if (!fs.existsSync(BASE_OUTPUT_DIR)) {
    fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
}

const ROOT_DIR = process.cwd();
const PROJECT_NAME = path.basename(ROOT_DIR);
const OBSIDIAN_VAULT_NAME = "Codes Snippets Flashcards Diagrams";

const files = globSync('**/*.{c,cpp,h,hpp,php,go,py,dart}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.dart_tool/**', '.docs_output/**', 'venv/**', '.git/**']
});

if (files.length === 0) {
    console.log('❌ No valid source file targets discovered.');
    process.exit(0);
}

// Map extensions directly to their npm language package names
const LANGUAGE_PACKAGES = {
    '.py': 'tree-sitter-python',
    '.go': 'tree-sitter-go',
    '.dart': 'tree-sitter-dart',
    '.php': 'tree-sitter-php',
    '.c': 'tree-sitter-c',
    '.cpp': 'tree-sitter-cpp',
    '.h': 'tree-sitter-c',
    '.hpp': 'tree-sitter-cpp'
};

const getStructuralLabel = (nodeType) => {
    const type = nodeType.toLowerCase();
    if (['class_definition', 'struct_specifier', 'type_declaration', 'trait_declaration', 'interface_declaration'].includes(type)) {
        return 'Class/Struct';
    }
    if (['function_definition', 'method_declaration', 'method_definition', 'function_declaration'].includes(type)) {
        return 'Routine';
    }
    if (['package_clause', 'namespace_definition', 'preproc_include', 'include_statement'].includes(type)) {
        return 'Directive';
    }
    return null;
};

const fileOutlines = {};

function runPipeline() {
    // Instantiating the parser class directly with no async initialization needed!
    const parser = new Parser();

    console.log(`🤖 Initializing native AST mapping engines for [${PROJECT_NAME}]...`);

    const loadedLanguages = {};

    for (const file of files) {
        const absolutePath = path.resolve(file).replace(/\\/g, '/');
        const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
        const ext = path.extname(file).toLowerCase();

        const pkgName = LANGUAGE_PACKAGES[ext];
        if (!pkgName) continue;

        try {
            // Load the language grammar dynamically from the local or global node_modules context
            if (!loadedLanguages[pkgName]) {
                try {
                    loadedLanguages[pkgName] = require(pkgName);
                } catch {
                    // Fallback to checking paths relative to the running directory root
                    const fallbackPath = path.join(ROOT_DIR, 'node_modules', pkgName);
                    loadedLanguages[pkgName] = require(fallbackPath);
                }
            }

            parser.setLanguage(loadedLanguages[pkgName]);
            const rawCode = fs.readFileSync(absolutePath, 'utf-8');
            const tree = parser.parse(rawCode);

            let outlineLines = [];
            
            function walk(node, level = 0) {
                const gap = "  ".repeat(level);
                const label = getStructuralLabel(node.type);
                let nextLevel = level;

                if (label) {
                    // tree-sitter uses .text property natively on nodes to grab code segments
                    const nameNode = node.childForFieldName('name') || node.child(1);
                    const actualName = nameNode ? nameNode.text.split('\n')[0] : node.type;
                    outlineLines.push(`${gap}- [${label}] ${actualName}`);
                    nextLevel = level + 1;
                }

                // Native tree-sitter uses namedChildren or children arrays
                for (let i = 0; i < node.childCount; i++) {
                    walk(node.child(i), nextLevel);
                }
            }

            walk(tree.rootNode, 0);

            const markdownOutline = outlineLines.join('\n');
            fileOutlines[relativePath] = markdownOutline;

            const blockOutline = outlineLines
                .map(line => line.replace(/^(\s*)-\s*/, '$1'))
                .join('\n');

            const encodedVault = encodeURIComponent(OBSIDIAN_VAULT_NAME);
            const obsidianEscapedPath = `temp/` + absolutePath.replace(/\//g, '-s-') + '.md';
            const encodedObsidianPath = encodeURIComponent(obsidianEscapedPath);

            const obsidianUri = `obsidian://open?vault=${encodedVault}&file=${encodedObsidianPath}`;
            const fileUri = `file://${absolutePath}`;
            const vscodeUri = `vscode://file/${absolutePath}`;

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
${blockOutline || '// No structural definitions parsed'}
\`\`\`
`;

            const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
            fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

        } catch (err) {
            console.error(`❌ Native Parse failed on target [${relativePath}]:`, err.message);
        }
    }

    let masterContent = `# Multi-Language Structural Catalog Blueprint Index\n\n## Polyglot Project Workspace Module Map\n`;
    Object.keys(fileOutlines).forEach(relativePath => {
        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
        const componentMdUri = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;
        const cleanBlockLines = fileOutlines[relativePath]
            ? fileOutlines[relativePath].split('\n').map(line => line.replace(/^(\s*)-\s*/, '$1')).join('\n')
            : '// Empty Module Schema';

        masterContent += `\n### 📄 Module Summary Mapping: \`${relativePath}\`\n* [Open Workspace View](${componentMdUri})\n\n#### Structural Architecture Profile\n${fileOutlines[relativePath] || '  * *Empty Module Details*'}\n\n\`\`\`outline\n${cleanBlockLines}\n\`\`\`\n\n--- \n`;
    });

    fs.writeFileSync(path.join(BASE_OUTPUT_DIR, 'DOC.md'), masterContent, 'utf-8');
    console.log('\n========= NODE-NATIVE AST GENERATOR COMPLETE =========');
}

runPipeline();