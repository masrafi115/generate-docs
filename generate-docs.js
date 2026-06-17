#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import * as parser from '@babel/parser';
import traversePkg from '@babel/traverse';

// Handle Babel's default export quirks across ESM environments safely
const traverse = traversePkg.default || traversePkg;

// Helper to resolve paths containing tildes (~)
function resolveHome(filepath) {
    if (filepath.startsWith('~')) {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return path.resolve(filepath);
}

// 1. Determine Target Output Directory from Command Line Arguments
const targetArg = process.argv[2];
let BASE_OUTPUT_DIR;

if (targetArg) {
    BASE_OUTPUT_DIR = resolveHome(targetArg);
} else {
    BASE_OUTPUT_DIR = path.join(process.cwd(), '.docs_output');
}

// Ensure output directory exists
if (!fs.existsSync(BASE_OUTPUT_DIR)) {
    fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
}

const ROOT_DIR = process.cwd();

// 2. Find all JS and TS files
const files = globSync('**/*.{js,jsx,ts,tsx}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'generate-docs.js']
});

if (files.length === 0) {
    console.log('❌ No JavaScript or TypeScript files found in the current directory.');
    process.exit(0);
}

const astRegistry = {};
const dependencies = [];

console.log(`Parsing ${files.length} files from: ${ROOT_DIR}`);

files.forEach(file => {
    const absolutePath = path.resolve(file);
    const relativePath = path.relative(ROOT_DIR, file);
    
    try {
        const code = fs.readFileSync(absolutePath, 'utf-8');
        
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties']
        });

        astRegistry[relativePath] = ast;

        traverse(ast, {
            ImportDeclaration(nodePath) {
                const source = nodePath.node.source.value;
                if (source.startsWith('.')) {
                    const dir = path.dirname(relativePath);
                    let resolved = path.normalize(path.join(dir, source)).replace(/\\/g, '/');
                    dependencies.push({ from: relativePath, to: resolved });
                }
            },
            CallExpression(nodePath) {
                if (nodePath.node.callee.type === 'Import' && nodePath.node.arguments[0]?.type === 'StringLiteral') {
                    const source = nodePath.node.arguments[0].value;
                    if (source.startsWith('.')) {
                        const dir = path.dirname(relativePath);
                        let resolved = path.normalize(path.join(dir, source)).replace(/\\/g, '/');
                        dependencies.push({ from: relativePath, to: resolved });
                    }
                }
            }
        });
    } catch (err) {
        console.error(`❌ Failed to parse ${relativePath}:`, err.message);
    }
});

// 3. Save Payload Data
const astJsonPath = path.join(BASE_OUTPUT_DIR, 'entire_ast.json');
fs.writeFileSync(astJsonPath, JSON.stringify(astRegistry, null, 2), 'utf-8');

// 4. Generate Mermaid
const cleanPath = (p) => p.replace(/\.(ts|js|tsx|jsx)$/, '');
let mermaidCode = 'graph TD\n';
files.forEach(file => { mermaidCode += `    ["${file}"]\n`; });
dependencies.forEach(dep => {
    const matchedTarget = files.find(f => cleanPath(f) === cleanPath(dep.to)) || dep.to;
    mermaidCode += `    ["${dep.from}"] --> ["${matchedTarget}"]\n`;
});

const mermaidPath = path.join(BASE_OUTPUT_DIR, 'architecture.mmd');
fs.writeFileSync(mermaidPath, mermaidCode, 'utf-8');

// 5. Generate DOC.md in the Specified Target Folder
const astUri = `file://${path.resolve(astJsonPath).replace(/\\/g, '/')}`;
const mermaidUri = `file://${path.resolve(mermaidPath).replace(/\\/g, '/')}`;

const markdownContent = `# Project Architecture Documentation

This document links to structural metadata generated from codebase source files at:  
\`${ROOT_DIR}\`

## Generated Artifacts
* **Entire Codebase AST (JSON):** [Open AST JSON File](${astUri})
* **Dependency Flow Diagram (Mermaid):** [Open Mermaid File](${mermaidUri})

## Codebase Architecture Diagram Preview
\`\`\`mermaid
${mermaidCode}\`\`\`

---
*Generated automatically on ${new Date().toLocaleString()}*
`;

const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
fs.writeFileSync(docMdPath, markdownContent, 'utf-8');

console.log('\n========= SUCCESS =========');
console.log(`✔ Entire AST JSON -> ${astJsonPath}`);
console.log(`✔ Mermaid Code    -> ${mermaidPath}`);
console.log(`✔ Documentation   -> ${docMdPath}`);
console.log('===========================');
