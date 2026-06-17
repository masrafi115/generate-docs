#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';

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

const files = globSync('**/*.dart', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.dart_tool/**', '.docs_output/**']
});

if (files.length === 0) {
    console.log('❌ No Dart targets found.');
    process.exit(0);
}

const fileOutlines = {}; 

// =========================================================================
// 🧠 PURE JS DART LEXER & TREE PARSER (Generates true nested JSON AST maps)
// =========================================================================
const parseDartToTrueAst = (code) => {
    // Clean code by stripping block and line comments while preserving layout space
    const cleanCode = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    // Tokenize into words, symbols, and string literals
    const tokenRegex = /[A-Za-z0-9_.]+|[{}([\]);,]|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/g;
    const tokens = cleanCode.match(tokenRegex) || [];
    
    let index = 0;

    // Helper to peek ahead in the token stream
    const peek = (offset = 0) => tokens[index + offset] || null;
    // Helper to consume the current token
    const next = () => tokens[index++];

    // Recursively processes code execution blocks to build true structural hierarchies
    const parseBlock = (endSymbol) => {
        let nodes = [];

        while (index < tokens.length) {
            let token = peek();
            if (token === endSymbol) {
                next(); // consume closer
                break;
            }

            if (token === '{' || token === '(' || token === '[') {
                const opener = next();
                const closer = opener === '{' ? '}' : (opener === '(' ? ')' : ']');
                // Create a sub-structural array container for tracking nested properties
                const subChildren = parseBlock(closer);
                if (nodes.length > 0) {
                    nodes[nodes.length - 1].children = (nodes[nodes.length - 1].children || []).concat(subChildren);
                }
                continue;
            }

            // Detect Class Structural Declarations
            if (token === 'class' || token === 'abstract') {
                let fullSig = [];
                while (peek() && peek() !== '{' && peek() !== ';') {
                    fullSig.push(next());
                }
                nodes.push({
                    type: "ClassDeclarationImpl",
                    source: fullSig.join(' '),
                    children: []
                });
                continue;
            }

            // Detect Instance Conversions (Widgets/Objects)
            if (/^[A-Z]/.test(token) && peek(1) === '(') {
                const wName = token;
                next(); // consume name
                next(); // consume '('
                
                const widgetNode = {
                    type: "InstanceCreationExpressionImpl",
                    source: `${wName}()`,
                    children: [
                        { type: "SimpleIdentifierImpl", source: wName }
                    ]
                };
                
                // Recursively gather parameters inside the instantiation brackets
                const innerParams = parseBlock(')');
                widgetNode.children = widgetNode.children.concat(innerParams);
                nodes.push(widgetNode);
                continue;
            }

            // Detect Method and Function Declarations
            if (/^[A-Za-z0-9_<>?]+$/.test(token) && /^[a-z]/.test(peek(1)) && peek(2) === '(') {
                const returnType = token;
                const methodName = next();
                next(); // consume function name
                next(); // consume '('
                
                const methodNode = {
                    type: "MethodDeclarationImpl",
                    source: `${returnType} ${methodName}()`,
                    children: [
                        { type: "NamedTypeImpl", source: returnType }
                    ]
                };
                
                const innerArgs = parseBlock(')');
                methodNode.children = methodNode.children.concat(innerArgs);
                nodes.push(methodNode);
                continue;
            }

            // Capture unmapped expressions safely as text snippets
            const currentToken = next();
            if (/^[A-Za-z0-9_]+$/.test(currentToken)) {
                nodes.push({
                    type: "SimpleIdentifierImpl",
                    source: currentToken
                });
            }
        }

        return nodes;
    };

    return parseBlock(null);
};

// ==========================================
// 🎯 PORTED JQ LOGIC ENGINE
// ==========================================
const isWidget = (node) => {
    if (node.type === "MethodInvocationImpl" || node.type === "InstanceCreationExpressionImpl") {
        if (!node.children || !Array.isArray(node.children)) return false;
        const target = node.children.find(c => c.type === "SimpleIdentifierImpl" || c.type === "ConstructorNameImpl");
        const source = target?.source || "";
        const baseName = source.split('.')[0];
        return /^[A-Z]/.test(baseName) && !/^(MediaQuery|EdgeInsets|BoxFit|Colors|Icons|GoogleFonts|MainAxis|CrossAxis|FontWeight|TextStyle|WidgetState|Alignment|Navigator|ResponsiveBreakpoints|ModalRoute)$/.test(baseName);
    }
    return false;
};

const widgetName = (node) => {
    if (!node.children || !Array.isArray(node.children)) return "";
    const target = node.children.find(c => c.type === "SimpleIdentifierImpl" || c.type === "ConstructorNameImpl");
    return (target?.source || "").split('.')[0];
};

const getType = (node) => {
    if (node.type === "MethodDeclarationImpl" || node.type === "FunctionDeclarationImpl") {
        if (!node.children) return "void";
        return node.children.find(c => c.type === "NamedTypeImpl")?.source || "void";
    }
    if (node.type === "FieldDeclarationImpl") {
        if (!node.children || !node.children[0] || !node.children[0].children) return "dynamic";
        return node.children[0].children.find(c => c.type === "NamedTypeImpl")?.source || "dynamic";
    }
    return "";
};

const cleanSig = (sourceStr) => {
    if (!sourceStr) return "";
    return sourceStr.split('\n')[0].split('{')[0].split ';'[0].trim();
};

const walkDartOutline = (nodes, level = 0) => {
    if (!nodes || !Array.isArray(nodes)) return [];
    let lines = [];
    const gap = "  ".repeat(level);

    nodes.forEach(node => {
        if (!node) return;

        if (node.type === "ClassDeclarationImpl") {
            lines.push(`${gap}- ${cleanSig(node.source)}`);
            if (node.children) lines = lines.concat(walkDartOutline(node.children, level + 1));
        } 
        else if (node.type === "MethodDeclarationImpl" || node.type === "FunctionDeclarationImpl") {
            const typeStr = getType(node);
            lines.push(`${gap}- ${cleanSig(node.source)} [Returns: ${typeStr}]`);
            if (node.children) lines = lines.concat(walkDartOutline(node.children, level + 1));
        } 
        else if (node.type === "ConstructorDeclarationImpl" || node.type === "FieldDeclarationImpl") {
            const typeStr = getType(node);
            const typeSuffix = typeStr ? ` [Type: ${typeStr}]` : "";
            lines.push(`${gap}- ${cleanSig(node.source)}${typeSuffix}`);
        } 
        else if (isWidget(node)) {
            lines.push(`${gap}- ${widgetName(node)}`);
            if (node.children) lines = lines.concat(walkDartOutline(node.children, level + 1));
        } 
        else {
            if (node.children) lines = lines.concat(walkDartOutline(node.children, level));
        }
    });

    return lines;
};

console.log(`Analyzing codebase targets into structural representations for [${PROJECT_NAME}]...`);

files.forEach(file => {
    const absolutePath = path.resolve(file).replace(/\\/g, '/');
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    
    try {
        const code = fs.readFileSync(absolutePath, 'utf-8');
        
        // Generates actual object trees with matching brace/bracket levels
        const runtimeGeneratedAst = parseDartToTrueAst(code);

        let outlineLines = walkDartOutline(runtimeGeneratedAst, 0);
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

# Dart Codebase Outline: ${relativePath}

### File Architecture Metadata
* **Project Target:** \`${PROJECT_NAME}\`
* **Local System Path:** \`${absolutePath}\`

## Nested Component Blueprint Tree View

${markdownOutline || '*No trackable Class structures, Methods or Widget layouts found inside this module.*'}

## Structural Text Block View

\`\`\`outline
${blockOutline || '// No structural definitions parsed'}
\`\`\`
`;

        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

    } catch (err) {
        console.error(`❌ Parse execution failed on Dart asset target [${relativePath}]:`, err.message);
    }
});

// 3. Compile Master Index Summary Log Catalogue
let masterContent = `# Project Dart Blueprint Structural Catalog Index

---

## Workspace Dart Module Map Matrix
`;

Object.keys(fileOutlines).forEach(relativePath => {
    const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
    const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
    const componentMdUri = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

    const cleanBlockLines = fileOutlines[relativePath]
        ? fileOutlines[relativePath].split('\n').map(line => line.replace(/^(\s*)-\s*/, '$1')).join('\n')
        : '// Empty Module Scheme';

    masterContent += `\n### 📄 Module Summary Mapping: \`${relativePath}\`
* **Isolated Tree Document Matrix:** [Open Target File Workspace View](${componentMdUri})

#### Dart Module Structural Architecture Profile
${fileOutlines[relativePath] ? fileOutlines[relativePath] : '  * *Empty Module Core Details*'}

#### Core Blueprint Structure Custom Block Preview
\`\`\`outline
${cleanBlockLines}
\`\`\`

---
`;
});

masterContent += `\n*Generated automatically on ${new Date().toLocaleString()}*`;

const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
fs.writeFileSync(docMdPath, masterContent, 'utf-8');

console.log('\n========= PURE COMPILER-LESS TREE PARSER COMPLETE =========');
console.log(`✔ Isolated Structural Modules Mapped   -> ${Object.keys(fileOutlines).length} files parsed`);
console.log(`✔ Master Catalog Documentation Doc  -> ${docMdPath}`);
console.log('=====================================================');
//Test 