#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import jsxPlugin from 'acorn-jsx';
import { walk } from 'estree-walker';
import phpParser from 'php-parser';

/**
 * Generate Extended Mermaid for php, js, ts, jsx, tsx
 * Captures nearby comment blocks (line comments, block comments, JSDoc/PHPDoc)
 */
const JsParser = acorn.Parser.extend(tsPlugin(), jsxPlugin());

const PhpEngine = new phpParser({
    parser: { debug: false, extractDoc: true, suppressErrors: true },
    ast: { withPositions: true },
});

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

const jsFiles = globSync('**/*.{js,jsx,ts,tsx}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'generate-docs.js', 'generate-docs.mjs']
});

const phpFiles = globSync('**/*.php', {
    ignore: ['node_modules/**', 'vendor/**', 'dist/**', 'build/**']
});

const allFiles = [
    ...jsFiles.map(f => ({ file: f, lang: 'js' })),
    ...phpFiles.map(f => ({ file: f, lang: 'php' })),
];

if (allFiles.length === 0) {
    console.log('❌ No JavaScript, TypeScript, or PHP files found.');
    process.exit(0);
}

const astRegistry = {};
const fileDiagrams = {};

console.log(`Parsing advanced structural AST maps for project [${PROJECT_NAME}]...`);
console.log(`  JS/TS files : ${jsFiles.length}`);
console.log(`  PHP files   : ${phpFiles.length}`);

// ─── Shared helpers ───────────────────────────────────────────────────────────

const cleanLabel = (str) =>
    (str || '')
        .replace(/["'\\]/g, '')
        .replace(/\n/g, ' ')
        .trim()
        .slice(0, 40);

// Truncate a raw source snippet for a node label
const cleanCodeSnippet = (node, fullCode) => {
    if (!node) return '';
    const src = fullCode.slice(node.start, node.end)
        .replace(/["'\\]/g, '')
        .replace(/\n/g, ' ');
    return src.length > 30 ? src.slice(0, 27) + '...' : src;
};

const extractJsParams = (paramsArray) => {
    if (!paramsArray || paramsArray.length === 0) return 'none';
    return paramsArray.map(p => {
        if (p.type === 'Identifier') return p.name;
        if (p.type === 'AssignmentPattern') return p.left?.name || 'param';
        if (p.type === 'RestElement') return `...${p.argument?.name || ''}`;
        return 'param';
    }).join(', ');
};

// ─── Comment helpers ──────────────────────────────────────────────────────────

/**
 * Format a raw comment value into a compact label string.
 * Strips delimiters, collapses whitespace, and truncates.
 */
const formatComment = (rawValue, kind) => {
    let text = rawValue || '';
    // Strip block comment delimiters if any slip through
    text = text.replace(/^\/\*+|\*+\/$/g, '').trim();
    // Strip leading asterisks per line (JSDoc / PHPDoc style)
    text = text.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).join(' ');
    text = text.replace(/\s+/g, ' ').trim();
    const icon = kind === 'commentblock' || kind === 'Block' ? '📝' : '💬';
    return `${icon} ${text.length > 50 ? text.slice(0, 47) + '...' : text}`;
};

/**
 * Build acorn comment collector option and return the collected array.
 * Acorn fires onComment for every comment in the source.
 */
const buildAcornCommentCollector = () => {
    const comments = [];
    const onComment = (isBlock, text, start, end, locStart) => {
        comments.push({ isBlock, text, start, end, line: locStart?.line });
    };
    return { comments, onComment };
};

/**
 * For a JS/TS AST node, find comments whose end position is immediately
 * before the node's start (allowing up to ~3 blank lines of gap).
 */
const findLeadingJsComments = (nodeStart, comments, code) => {
    const preceding = comments.filter(c => c.end <= nodeStart);
    if (!preceding.length) return [];

    // Walk backwards from node, collect contiguous comment block
    const result = [];
    // Sort descending by end
    const sorted = [...preceding].sort((a, b) => b.end - a.end);

    for (const c of sorted) {
        const gap = code.slice(c.end, nodeStart).trim();
        // Allow only whitespace/newlines between comment and node (or next comment)
        if (result.length === 0 && gap.replace(/\s/g, '').length === 0) {
            result.unshift(c);
            // Now check for comment immediately before this one
        } else if (result.length > 0) {
            const nextStart = result[0].start;
            const innerGap = code.slice(c.end, nextStart).trim();
            if (innerGap.replace(/\s/g, '').length === 0) {
                result.unshift(c);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    return result;
};

// ─── JS/TS diagram builder ────────────────────────────────────────────────────

function buildJsDiagram(code, relativePath) {
    const { comments, onComment } = buildAcornCommentCollector();

    const ast = JsParser.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        onComment,
    });

    let mermaidCode = `graph LR\n`;
    mermaidCode += `    Root["📦 Module: ${relativePath}"]\n`;
    mermaidCode += `    classDef condition fill:#6e251e,stroke:#e06c75,stroke-width:1px,color:#fff;\n`;
    mermaidCode += `    classDef loop fill:#5c401b,stroke:#d19a66,stroke-width:1px,color:#fff;\n`;
    mermaidCode += `    classDef exec fill:#1e40af,stroke:#3b82f6,stroke-width:2px,color:#fff;\n`;
    mermaidCode += `    classDef io fill:#115e59,stroke:#14b8a6,stroke-width:1px,color:#fff;\n`;
    mermaidCode += `    classDef exit fill:#374151,stroke:#9ca3af,stroke-width:1px,color:#fff;\n`;
    mermaidCode += `    classDef comment fill:#2d2d2d,stroke:#6b7280,stroke-width:1px,color:#d1d5db,font-style:italic;\n`;
    mermaidCode += `    style Root fill:#1f6feb,stroke:#388bfd,stroke-width:2px,color:#fff\n`;

    let nodeIdCounter = 0;
    const nodeMap = new Map();
    const emittedComments = new Set();

    const emit = (id, shape, cls) => {
        mermaidCode += `    ${shape}\n`;
        if (cls) mermaidCode += `    class ${id} ${cls};\n`;
    };

    const attachLeadingComments = (nodeStart, parentId) => {
        const leading = findLeadingJsComments(nodeStart, comments, code);
        let lastCommentId = parentId;
        for (const c of leading) {
            if (emittedComments.has(c.start)) continue;
            emittedComments.add(c.start);
            nodeIdCounter++;
            const cid = `node_${nodeIdCounter}`;
            const label = cleanLabel(formatComment(c.text, c.isBlock ? 'Block' : 'Line'));
            emit(cid, `    ${lastCommentId} -. "${label}" .-> ${cid}["${label}"]`, 'comment');
            lastCommentId = cid;
        }
        return lastCommentId;
    };

    walk(ast, {
        enter(node, parent) {
            nodeIdCounter++;
            let currentId = `node_${nodeIdCounter}`;
            let label = '';
            let shapeStr = '';
            let elementClass = '';

            let parentId = parent ? nodeMap.get(parent) : 'Root';
            if (!parentId) parentId = 'Root';

            switch (node.type) {
                case 'ImportDeclaration':
                    label = `📥 Import\\nFrom: ${cleanLabel(node.source.value)}`;
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
                    const params = extractJsParams(node.params);
                    label = `⚙️ Function: ${name}()\\nParams: [${params}]`;
                    shapeStr = `["${label}"]`;
                    elementClass = 'exec';
                    break;
                }

                case 'VariableDeclarator':
                    if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
                        const name = node.id?.name || 'anonymous';
                        const params = extractJsParams(node.init.params);
                        label = `⚙️ Arrow Function: ${name}()\\nParams: [${params}]`;
                        shapeStr = `["${label}"]`;
                        elementClass = 'exec';
                    } else {
                        nodeMap.set(node, parentId);
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
                    nodeMap.set(node, parentId);
                    return;
            }

            // Attach leading comments before this node
            const bridgeId = attachLeadingComments(node.start, parentId);
            nodeMap.set(node, currentId);
            mermaidCode += `    ${bridgeId} --> ${currentId}${shapeStr}\n`;
            if (elementClass) mermaidCode += `    class ${currentId} ${elementClass};\n`;
        }
    });

    return { ast, mermaidCode };
}

// ─── PHP diagram builder ──────────────────────────────────────────────────────

/**
 * Recursively walk a php-parser AST node, emitting Mermaid nodes.
 * php-parser attaches leadingComments directly on AST nodes.
 */
function walkPhpNode(node, parentId, ctx) {
    if (!node || typeof node !== 'object' || !node.kind) return;

    const { mermaidCode, nodeIdCounter, emittedComments } = ctx;
    ctx.nodeIdCounter++;
    const currentId = `node_${ctx.nodeIdCounter}`;
    let label = '';
    let shapeStr = '';
    let elementClass = '';

    // --- Attach leading PHP comments ---
    const leadingComments = node.leadingComments || [];
    let bridgeId = parentId;
    for (const c of leadingComments) {
        const key = `${c.kind}:${c.offset}`;
        if (emittedComments.has(key)) continue;
        emittedComments.add(key);
        ctx.nodeIdCounter++;
        const cid = `node_${ctx.nodeIdCounter}`;
        const clabel = cleanLabel(formatComment(c.value, c.kind));
        ctx.mermaidLines.push(`    ${bridgeId} -. "${clabel}" .-> ${cid}["${clabel}"]`);
        ctx.mermaidLines.push(`    class ${cid} comment;`);
        bridgeId = cid;
    }

    let children = [];
    let skip = false;

    switch (node.kind) {
        case 'namespace': {
            const nsName = typeof node.name === 'string' ? node.name : (node.name?.name || '');
            label = `🗂️ Namespace: ${cleanLabel(nsName)}`;
            shapeStr = `["${label}"]`;
            elementClass = 'io';
            children = node.children || [];
            break;
        }

        case 'usegroup': {
            const items = (node.items || []).map(i => cleanLabel(i.name || '')).join(', ');
            label = `📥 Use: ${items.slice(0, 40)}`;
            shapeStr = `>"${label}"]`;
            elementClass = 'io';
            break;
        }

        case 'class': {
            const cname = node.name?.name || node.name || 'AnonymousClass';
            const ext = node.extends ? ` extends ${node.extends.name || ''}` : '';
            const impl = (node.implements || []).map(i => i.name || '').join(', ');
            label = `🏛️ Class: ${cleanLabel(cname)}${cleanLabel(ext)}${impl ? '\\nimplements: ' + cleanLabel(impl) : ''}`;
            shapeStr = `["${label}"]`;
            elementClass = 'exec';
            children = node.body || [];
            break;
        }

        case 'interface': {
            const iname = node.name?.name || node.name || 'Interface';
            label = `🔌 Interface: ${cleanLabel(iname)}`;
            shapeStr = `["${label}"]`;
            elementClass = 'io';
            children = node.body || [];
            break;
        }

        case 'trait': {
            const tname = node.name?.name || node.name || 'Trait';
            label = `🧩 Trait: ${cleanLabel(tname)}`;
            shapeStr = `["${label}"]`;
            elementClass = 'io';
            children = node.body || [];
            break;
        }

        case 'method':
        case 'function': {
            const fname = node.name?.name || node.name || 'anonymous';
            const params = (node.arguments || []).map(p => {
                const pname = p.name?.name || p.name || 'param';
                return (p.variadic ? '...' : '') + '$' + pname;
            }).join(', ');
            const visibility = node.visibility || '';
            const isStatic = node.isStatic ? 'static ' : '';
            label = `⚙️ ${isStatic}${visibility ? visibility + ' ' : ''}${node.kind === 'method' ? 'Method' : 'Function'}: ${fname}()\\nParams: [${params || 'none'}]`;
            shapeStr = `["${label}"]`;
            elementClass = 'exec';
            children = node.body ? (node.body.children || []) : [];
            break;
        }

        case 'if': {
            const testSrc = node.test ? (node.test.name || node.test.value || node.test.kind || '') : '';
            label = `🌿 If: ${cleanLabel(String(testSrc))}`;
            shapeStr = `{"${label}"}`;
            elementClass = 'condition';
            children = [
                ...(node.body?.children || node.body ? [node.body] : []),
                ...(node.alternate ? [node.alternate] : []),
            ];
            break;
        }

        case 'switch': {
            const switchTest = node.test ? (node.test.name || node.test.kind || '') : '';
            label = `🔀 Switch On: ${cleanLabel(String(switchTest))}`;
            shapeStr = `{"${label}"}`;
            elementClass = 'condition';
            children = node.body?.children || [];
            break;
        }

        case 'for':
        case 'foreach':
        case 'while':
        case 'do-while': {
            label = `🔁 Loop Block\\n${node.kind}`;
            shapeStr = `(("${label}"))`;
            elementClass = 'loop';
            children = node.body?.children || (node.body ? [node.body] : []);
            break;
        }

        case 'return': {
            const retKind = node.expr?.kind || '';
            const retName = node.expr?.name || node.expr?.value || retKind;
            label = `↩️ Return: ${cleanLabel(String(retName || 'void'))}`;
            shapeStr = `["${label}"]`;
            elementClass = 'exit';
            break;
        }

        case 'throw': {
            const errKind = node.what?.what?.name || node.what?.kind || '';
            label = `💥 Throw: ${cleanLabel(errKind)}`;
            shapeStr = `["${label}"]`;
            elementClass = 'exit';
            break;
        }

        case 'echo': {
            label = `📢 Echo`;
            shapeStr = `["${label}"]`;
            elementClass = 'io';
            break;
        }

        case 'expressionstatement':
        case 'expression':
            // Descend into children without emitting a node
            children = node.expression ? [node.expression] : [];
            skip = true;
            break;

        case 'block':
            children = node.children || [];
            skip = true;
            break;

        default:
            // Silently descend into known container-like nodes
            {
                const possibleChildren = node.children || node.body?.children || node.body || [];
                if (Array.isArray(possibleChildren) && possibleChildren.length) {
                    children = possibleChildren;
                }
                skip = true;
            }
            break;
    }

    if (!skip) {
        ctx.mermaidLines.push(`    ${bridgeId} --> ${currentId}${shapeStr}`);
        if (elementClass) ctx.mermaidLines.push(`    class ${currentId} ${elementClass};`);

        // Walk children with currentId as parent
        const effectiveChildren = Array.isArray(children) ? children : (children ? [children] : []);
        for (const child of effectiveChildren) {
            walkPhpNode(child, currentId, ctx);
        }
    } else {
        // Use bridgeId (or parentId) for children
        const effectiveChildren = Array.isArray(children) ? children : (children ? [children] : []);
        for (const child of effectiveChildren) {
            walkPhpNode(child, bridgeId, ctx);
        }
    }
}

function buildPhpDiagram(code, relativePath) {
    const ast = PhpEngine.parseCode(code, relativePath);

    let mermaidHeader = `graph LR\n`;
    mermaidHeader += `    Root["🐘 PHP Module: ${relativePath}"]\n`;
    mermaidHeader += `    classDef condition fill:#6e251e,stroke:#e06c75,stroke-width:1px,color:#fff;\n`;
    mermaidHeader += `    classDef loop fill:#5c401b,stroke:#d19a66,stroke-width:1px,color:#fff;\n`;
    mermaidHeader += `    classDef exec fill:#1e40af,stroke:#3b82f6,stroke-width:2px,color:#fff;\n`;
    mermaidHeader += `    classDef io fill:#115e59,stroke:#14b8a6,stroke-width:1px,color:#fff;\n`;
    mermaidHeader += `    classDef exit fill:#374151,stroke:#9ca3af,stroke-width:1px,color:#fff;\n`;
    mermaidHeader += `    classDef comment fill:#2d2d2d,stroke:#6b7280,stroke-width:1px,color:#d1d5db,font-style:italic;\n`;
    mermaidHeader += `    style Root fill:#7c3aed,stroke:#a78bfa,stroke-width:2px,color:#fff\n`;

    const ctx = {
        mermaidLines: [],
        nodeIdCounter: 0,
        emittedComments: new Set(),
    };

    for (const child of (ast.children || [])) {
        walkPhpNode(child, 'Root', ctx);
    }

    const mermaidCode = mermaidHeader + ctx.mermaidLines.join('\n') + '\n';
    return { ast, mermaidCode };
}

// ─── Process all files ────────────────────────────────────────────────────────

for (const { file, lang } of allFiles) {
    const absolutePath = path.resolve(file).replace(/\\/g, '/');
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');

    try {
        const code = fs.readFileSync(absolutePath, 'utf-8');

        let ast, mermaidCode;
        if (lang === 'php') {
            ({ ast, mermaidCode } = buildPhpDiagram(code, relativePath));
        } else {
            ({ ast, mermaidCode } = buildJsDiagram(code, relativePath));
        }

        astRegistry[relativePath] = ast;
        fileDiagrams[relativePath] = mermaidCode;

        // Frontmatter generation
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
language: ${lang}
---

# Deep AST Flow Map: ${relativePath}

### Target Information Metrics
* **Project Reference:** \`${PROJECT_NAME}\`
* **Language:** \`${lang.toUpperCase()}\`
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
}

// ─── Write workspace metadata files ──────────────────────────────────────────

const astJsonPath = path.join(BASE_OUTPUT_DIR, 'entire_ast.json');
fs.writeFileSync(astJsonPath, JSON.stringify(astRegistry, null, 2), 'utf-8');

// ─── Compile Master DOC.md ────────────────────────────────────────────────────

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
