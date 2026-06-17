#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import jsxPlugin from 'acorn-jsx';
import { walk } from 'estree-walker';

const Parser = acorn.Parser.extend(tsPlugin(), jsxPlugin());

function resolveHome(filepath) {
    if (filepath.startsWith('~')) {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return path.resolve(filepath);
}

// 1. Setup target directory paths
const targetArg = process.argv[2];
let BASE_OUTPUT_DIR = targetArg ? resolveHome(targetArg) : path.join(process.cwd(), '.docs_output');

if (!fs.existsSync(BASE_OUTPUT_DIR)) {
    fs.mkdirSync(BASE_OUTPUT_DIR, { recursive: true });
}

const ROOT_DIR = process.cwd();
const PROJECT_NAME = path.basename(ROOT_DIR); 
const OBSIDIAN_VAULT_NAME = "Codes Snippets Flashcards Diagrams"; 

const files = globSync('**/*.{js,jsx,ts,tsx}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'generate-docs.js', 'generate-docs.mjs']
});

if (files.length === 0) {
    console.log('❌ No JavaScript or TypeScript files found in the current directory.');
    process.exit(0);
}

const astRegistry = {};
const fileDiagrams = {};

console.log(`Parsing structural definitions for project [${PROJECT_NAME}]...`);

files.forEach(file => {
    const absolutePath = path.resolve(file).replace(/\\/g, '/');
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    
    try {
        const code = fs.readFileSync(absolutePath, 'utf-8');
        
        const ast = Parser.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: true
        });

        astRegistry[relativePath] = ast;

        // Changed to graph LR (Left to Right)
        let mermaidCode = `graph LR\n`;
        mermaidCode += `    Root["📦 Module: ${relativePath}"]\n`;
        mermaidCode += `    style Root fill:#1f6feb,stroke:#388bfd,stroke-width:2px,color:#fff\n`;

        let counter = 0;

        const extractParams = (paramsArray) => {
            if (!paramsArray || paramsArray.length === 0) return 'none';
            return paramsArray.map(p => {
                if (p.type === 'Identifier') return p.name;
                if (p.type === 'AssignmentPattern') return p.left?.name || 'param';
                if (p.type === 'RestElement') return `...${p.argument?.name || ''}`;
                return 'param';
            }).join(', ');
        };

        walk(ast, {
            enter(node) {
                counter++;
                let nodeId = '';
                let label = '';
                let nodeShape = '["Text"]';

                // 1. Standard Function Declarations (Metadata merged inside the node label)
                if (node.type === 'FunctionDeclaration') {
                    const name = node.id?.name || 'anonymous';
                    const params = extractParams(node.params);
                    nodeId = `func_${counter}`;
                    label = `⚙️ Function: ${name}\\n(Params: [${params}])`;
                    nodeShape = `["${label}"]`;
                } 
                // 2. Variable Arrow/Expression Functions & Constants
                else if (node.type === 'VariableDeclarator') {
                    const name = node.id?.name || 'variable';
                    nodeId = `var_${counter}`;
                    
                    if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
                        const params = extractParams(node.init.params);
                        label = `⚙️ Arrow Function: ${name}\\n(Params: [${params}])`;
                        nodeShape = `["${label}"]`;
                    } else {
                        label = `📄 Constant: ${name}`;
                        nodeShape = `(["${label}"])`;
                    }
                } 
                // 3. Object-Oriented Classes
                else if (node.type === 'ClassDeclaration') {
                    const name = node.id?.name || 'AnonymousClass';
                    const extension = node.superClass ? ` extends ${node.superClass.name}` : '';
                    nodeId = `class_${counter}`;
                    label = `🏛️ Class: ${name}${extension}`;
                    nodeShape = `[["${label}"]]`;
                } 
                // 4. Imports
                else if (node.type === 'ImportDeclaration') {
                    nodeId = `imp_${counter}`;
                    label = `📥 Import\\nFrom: "${node.source.value}"`;
                    nodeShape = `>"${label}"]`;
                } 
                // 5. Exports
                else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
                    nodeId = `exp_${counter}`;
                    label = `📤 Export Gateway`;
                    nodeShape = `{{\"${label}\"}}`;
                }

                if (nodeId && label) {
                    mermaidCode += `    Root --> ${nodeId}${nodeShape}\n`;
                }
            }
        });

        fileDiagrams[relativePath] = mermaidCode;

        // Dynamic URI configuration data
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

# Metadata Architecture: ${relativePath}

### File Environment Parameters
* **Project Name:** \`${PROJECT_NAME}\`
* **Local System Path:** \`${absolutePath}\`

## Component Structural View

\`\`\`mermaid
${mermaidCode}\`\`\`
`;

        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

    } catch (err) {
        console.error(`❌ Failed to parse ${relativePath}:`, err.message);
    }
});

// 2. Write structural workspace metadata files
const astJsonPath = path.join(BASE_OUTPUT_DIR, 'entire_ast.json');
fs.writeFileSync(astJsonPath, JSON.stringify(astRegistry, null, 2), 'utf-8');

// 3. Compile Master DOC.md Layout
const astUri = `file://${path.resolve(astJsonPath).replace(/\\/g, '/')}`;

let masterContent = `# Project Architecture Documentation

This directory registers modular maps extracted out of your system workspace components.

* **Complete Global AST Tree Data (JSON):** [Open Target Layout Node Data](${astUri})

---

## Workspace Map Matrix
`;

Object.keys(fileDiagrams).forEach(relativePath => {
    const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
    const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
    const componentMdUri = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

    masterContent += `\n### 📄 Module: \`${relativePath}\`
* **System Path:** \`${relativePath}\`
* **Isolated Structural File:** [Navigate to ${safeFileName}](${componentMdUri})

\`\`\`mermaid
${fileDiagrams[relativePath]}\`\`\`

---
`;
});

masterContent += `\n*Generated automatically on ${new Date().toLocaleString()}*`;

const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
fs.writeFileSync(docMdPath, masterContent, 'utf-8');

console.log('\n========= SUCCESS =========');
console.log(`✔ Complete Source AST JSON -> ${astJsonPath}`);
console.log(`✔ Isolated Structural Files -> ${Object.keys(fileDiagrams).length} markdown files compiled`);
console.log(`✔ Master Catalog Document  -> ${docMdPath}`);
console.log('===========================');
