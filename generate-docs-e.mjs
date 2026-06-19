#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import jsxPlugin from 'acorn-jsx';
import { walk } from 'estree-walker';

/**
* Generate Mermaid for js, ts, jsx,tsx
* 
*/
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
    console.log('❌ No JavaScript or TypeScript files found.');
    process.exit(0);
}

const astRegistry = {};
const fileDiagrams = {};

console.log(`Parsing advanced structural AST maps for project [${PROJECT_NAME}]...`);

// Helper to safely serialize expressions for node labels and remove breaking characters
const cleanCodeSnippet = (node, fullCode) => {
    if (!node) return '';
    const src = fullCode.slice(node.start, node.end)
        .replace(/["'\\]/g, '') // Strip quotes and slashes that break Mermaid syntax
        .replace(/\n/g, ' ');
    return src.length > 30 ? src.slice(0, 27) + '...' : src;
};

const extractParams = (paramsArray) => {
    if (!paramsArray || paramsArray.length === 0) return 'none';
    return paramsArray.map(p => {
        if (p.type === 'Identifier') return p.name;
        if (p.type === 'AssignmentPattern') return p.left?.name || 'param';
        if (p.type === 'RestElement') return `...${p.argument?.name || ''}`;
        return 'param';
    }).join(', ');
};

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

        let mermaidCode = `graph LR\n`;
        mermaidCode += `    Root["📦 Module: ${relativePath}"]\n`;
        
        // Semantic Theme Styling Definitions for Mermaid
        mermaidCode += `    classDef condition fill:#6e251e,stroke:#e06c75,stroke-width:1px,color:#fff;\n`;
        mermaidCode += `    classDef loop fill:#5c401b,stroke:#d19a66,stroke-width:1px,color:#fff;\n`;
        mermaidCode += `    classDef exec fill:#1e40af,stroke:#3b82f6,stroke-width:2px,color:#fff;\n`;
        mermaidCode += `    classDef io fill:#115e59,stroke:#14b8a6,stroke-width:1px,color:#fff;\n`;
        mermaidCode += `    classDef exit fill:#374151,stroke:#9ca3af,stroke-width:1px,color:#fff;\n`;
        mermaidCode += `    style Root fill:#1f6feb,stroke:#388bfd,stroke-width:2px,color:#fff\n`;

        let nodeIdCounter = 0;
        const nodeMap = new Map();

        // Recursively build execution and declaration chains
        walk(ast, {
            enter(node, parent) {
                nodeIdCounter++;
                let currentId = `node_${nodeIdCounter}`;
                let label = '';
                let shapeStr = '';
                let elementClass = '';

                // Connect current node to its logical parent block in the tree
                let parentId = parent ? nodeMap.get(parent) : 'Root';
                if (!parentId) parentId = 'Root';

                switch (node.type) {
                    case 'ImportDeclaration':
                        label = `📥 Import\\nFrom: ${node.source.value.replace(/["'\\]/g, '')}`;
                        shapeStr = `>"${label}"]`;
                        elementClass = 'io';
                        break;

                    case 'ExportNamedDeclaration':
                    case 'ExportDefaultDeclaration':
                        label = `📤 Export Gateway`;
                        shapeStr = `{"${label}"}`;
                        elementClass = 'io';
                        break;

                    case 'FunctionDeclaration': {
                        const name = node.id?.name || 'anonymous';
                        const params = extractParams(node.params);
                        label = `⚙️ Function: ${name}()\\nParams: [${params}]`;
                        shapeStr = `["${label}"]`;
                        elementClass = 'exec';
                        break;
                    }

                    case 'VariableDeclarator':
                        if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
                            const name = node.id?.name || 'anonymous';
                            const params = extractParams(node.init.params);
                            label = `⚙️ Arrow Function: ${name}()\\nParams: [${params}]`;
                            shapeStr = `["${label}"]`;
                            elementClass = 'exec';
                        } else {
                            // Skip generating individual nodes for basic variables to prevent tree clutter
                            return;
                        }
                        break;

                    case 'IfStatement': {
                        const testCondition = cleanCodeSnippet(node.test, code);
                        label = `🌿 If: ${testCondition}`;
                        shapeStr = `{"${label}"}`;
                        elementClass = 'condition';
                        break;
                    }

                    case 'SwitchStatement': {
                        const discriminant = cleanCodeSnippet(node.discriminant, code);
                        label = `🔀 Switch On: ${discriminant}`;
                        shapeStr = `{"${label}"}`;
                        elementClass = 'condition';
                        break;
                    }

                    case 'ForStatement':
                    case 'ForInStatement':
                    case 'ForOfStatement':
                    case 'WhileStatement':
                    case 'DoWhileStatement': {
                        label = `🔁 Loop Block\\n${node.type.replace('Statement', '')}`;
                        shapeStr = `(("${label}"))`;
                        elementClass = 'loop';
                        break;
                    }

                    case 'ReturnStatement': {
                        const returnVal = node.argument ? cleanCodeSnippet(node.argument, code) : 'void';
                        label = `↩️ Return: ${returnVal}`;
                        shapeStr = `["${label}"]`;
                        elementClass = 'exit';
                        break;
                    }

                    case 'ThrowStatement': {
                        const errVal = cleanCodeSnippet(node.argument, code);
                        label = `💥 Throw: ${errVal}`;
                        shapeStr = `["${label}"]`;
                        elementClass = 'exit';
                        break;
                    }

                    default:
                        // Maintain tracking context for nested sub-blocks without writing loose structural shapes
                        nodeMap.set(node, parentId);
                        return;
                }

                // Register tracking vector ID mapped to structural object instance
                nodeMap.set(node, currentId);

                // Write the branch edge linkage layout to code buffer
                mermaidCode += `    ${parentId} --> ${currentId}${shapeStr}\n`;
                if (elementClass) {
                    mermaidCode += `    class ${currentId} ${elementClass};\n`;
                }
            }
        });

        fileDiagrams[relativePath] = mermaidCode;

        // Frontmatter generation matching specifications
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

# Deep AST Flow Map: ${relativePath}

### Target Information Metrics
* **Project Reference:** \`${PROJECT_NAME}\`
* **Local System Reference:** \`${absolutePath}\`

## Component Execution Structural Flow

\`\`\`mermaid
${mermaidCode}\`\`\`
`;

        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

    } catch (err) {
        console.error(`❌ Parse execution failure on target module ${relativePath}:`, err.message);
    }
});

// 2. Write structural workspace metadata files
const astJsonPath = path.join(BASE_OUTPUT_DIR, 'entire_ast.json');
fs.writeFileSync(astJsonPath, JSON.stringify(astRegistry, null, 2), 'utf-8');

// 3. Compile Master DOC.md Layout
const astUri = `file://${path.resolve(astJsonPath).replace(/\\/g, '/')}`;
let masterContent = `# Advanced Project AST Compilation Architect Matrix

* **Global Native Root AST Graph JSON Map Data:** [Open Workspace Node Data Structure](${astUri})

---

## Workspace Map Matrix
`;

Object.keys(fileDiagrams).forEach(relativePath => {
    const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
    const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
    const componentMdUri = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

    masterContent += `\n### 📄 Module Map: \`${relativePath}\`
* **Isolated AST Map Target Document:** [Open Advanced File Manifest View](${componentMdUri})

\`\`\`mermaid
${fileDiagrams[relativePath]}\`\`\`

---
`;
});

masterContent += `\n*Generated automatically on ${new Date().toLocaleString()}*`;

const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
fs.writeFileSync(docMdPath, masterContent, 'utf-8');

console.log('\n========= ADVANCED MATRIX PARSE COMPLETE =========');
console.log(`✔ Collective Project Map Payload JSON -> ${astJsonPath}`);
console.log(`✔ Isolated Logical Modules Structured   -> ${Object.keys(fileDiagrams).length} targets mapped`);
console.log(`✔ Root Index Documentation Catalogue    -> ${docMdPath}`);
console.log('==================================================');
