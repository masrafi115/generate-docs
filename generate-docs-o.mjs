#!/usr/bin/env node

/**
 * Generate Outline for Web Projects: PHP, JS, CSS, TS, JSX, TSX
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { globSync } from 'glob';
import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import jsxPlugin from 'acorn-jsx';
import cssParser from 'css';
import PHPParserEngine from 'php-parser'; // ⚡ ADDED: JavaScript-Native PHP AST Parser

const Parser = acorn.Parser.extend(tsPlugin(), jsxPlugin());

// Initialize the PHP engine instance
const phpEngine = new PHPParserEngine({
    parser: {
        extractDoc: false,
        suppressErrors: true
    },
    ast: {
        withPositions: false
    }
});

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

// ⚡ UPDATED: Included 'php' extension in the glob pattern
const files = globSync('**/*.{js,jsx,ts,tsx,css,php}', {
    ignore: ['node_modules/**', 'dist/**', 'build/**', 'generate-docs.js', 'generate-docs.mjs', '.docs_output/**']
});

if (files.length === 0) {
    console.log('❌ No matching structural targets found.');
    process.exit(0);
}

const fileOutlines = {}; 

// ==========================================
// 🧪 TS / JS PARSE LOGIC
// ==========================================
const getNameTS = (node) => {
    if (!node) return '?';
    if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name;
    if (node.type === "MemberExpression" || node.type === "JSXMemberExpression") {
        return `${getNameTS(node.object)}.${getNameTS(node.property)}`;
    }
    return '?';
};

const getTypeTS = (node) => {
    if (!node) return "unknown";
    switch (node.type) {
        case "TSStringKeyword": return "string";
        case "TSNumberKeyword": return "number";
        case "TSBooleanKeyword": return "boolean";
        case "TSVoidKeyword": return "void";
        case "TSUnknownKeyword": return "unknown";
        case "TSUndefinedKeyword": return "undefined";
        case "TSNullKeyword": return "null";
        case "TSAnyKeyword": return "any";
        case "TSNeverKeyword": return "never";
        case "TSObjectKeyword": return "object";
        case "TSTypeReference": {
            const baseName = getNameTS(node.typeName);
            const params = node.typeParameters?.params ? `<${node.typeParameters.params.map(getTypeTS).join(", ")}>` : "";
            return `${baseName}${params}`;
        }
        case "TSArrayType": return `${getTypeTS(node.elementType)}[]`;
        case "TSUnionType": return node.types.map(getTypeTS).join(" | ");
        case "TSIntersectionType": return node.types.map(getTypeTS).join(" & ");
        case "TSLiteralType": return node.literal ? String(node.literal.value) : "literal";
        case "TSTypeLiteral": {
            const members = node.members ? node.members.map(m => {
                const opt = m.optional ? "?" : "";
                return `${m.key.name || getNameTS(m.key)}${opt}: ${getTypeTS(m.typeAnnotation?.typeAnnotation)}`;
            }).join("; ") : "";
            return `{ ${members} }`;
        }
        case "TSFunctionType": {
            const params = node.params ? node.params.map(p => {
                const name = p.name || "?";
                return `${name}: ${getTypeTS(p.typeAnnotation?.typeAnnotation)}`;
            }).join(", ") : "";
            return `(${params}) => ${getTypeTS(node.returnType?.typeAnnotation)}`;
        }
        case "TSIndexedAccessType": return `${getTypeTS(node.objectType)}[${getTypeTS(node.indexType)}]`;
        case "TSTypeQuery": return `typeof ${getNameTS(node.exprName)}`;
        case "TSTypeAnnotation": return getTypeTS(node.typeAnnotation);
        case "TSParenthesizedType": return `(${getTypeTS(node.typeAnnotation)})`;
        case "TSOptionalType": return `${getTypeTS(node.typeAnnotation)}?`;
        case "TSRestType": return `...${getTypeTS(node.typeAnnotation)}`;
        case "TSPredicate": return `${getNameTS(node.parameterName)} is ${getTypeTS(node.typeAnnotation?.typeAnnotation)}`;
        case "TSConditionalType": return `${getTypeTS(node.checkType)} extends ${getTypeTS(node.extendsType)} ? ${getTypeTS(node.trueType)} : ${getTypeTS(node.falseType)}`;
        default: return node.type;
    }
};

const getParamTS = (p) => {
    const name = p.name || (p.left && p.left.name) || "?";
    const opt = p.optional ? "?" : "";
    const type = p.typeAnnotation ? `: ${getTypeTS(p.typeAnnotation.typeAnnotation)}` : "";
    return `${name}${opt}${type}`;
};

const getParamsTS = (params) => {
    if (!params || params.length === 0) return "()";
    return `(${params.map(getParamTS).join(", ")})`;
};

const getReturnTS = (node) => {
    if (!node) return "";
    return `: ${getTypeTS(node.typeAnnotation)}`;
};

const walkTSOutline = (node, indent = 0) => {
    if (!node) return [];
    const gap = "  ".repeat(indent);
    let lines = [];

    switch (node.type) {
        case "ImportDeclaration":
            lines.push(`${gap}- **Import**: \`${node.source.value}\``);
            break;
        case "ExportNamedDeclaration":
            if (node.source) {
                lines.push(`${gap}- **Re-export**: \`${node.source.value}\``);
            } else if (node.declaration) {
                lines.push(`${gap}- **Export**`);
                lines = lines.concat(walkTSOutline(node.declaration, indent + 1));
            }
            break;
        case "TSTypeAliasDeclaration":
            lines.push(`${gap}- **Type**: \`${node.id.name}\``);
            break;
        case "TSInterfaceDeclaration":
            lines.push(`${gap}- **Interface**: \`${node.id.name}\``);
            if (node.body && node.body.body) {
                node.body.body.forEach(m => {
                    lines.push(`    ${gap}- \`${m.key.name || getNameTS(m.key)}\``);
                });
            }
            break;
        case "VariableDeclaration":
            if (node.declarations) {
                node.declarations.forEach(decl => {
                    const varName = decl.id.name || "?";
                    lines.push(`${gap}- **Var**: \`${varName}\``);
                });
            }
            break;
        case "FunctionDeclaration":
            lines.push(`${gap}- **Func**: \`${node.id.name}${getParamsTS(node.params)}${getReturnTS(node.returnType)}\``);
            break;
        case "ClassDeclaration":
            lines.push(`${gap}- **Class**: \`${node.id.name}\``);
            if (node.body && node.body.body) {
                node.body.body.forEach(sub => {
                    lines = lines.concat(walkTSOutline(sub, indent + 1));
                });
            }
            break;
        case "MethodDefinition": {
            const asyncMark = node.value?.async ? " *(async)*" : "";
            lines.push(`${gap}- [method/${node.kind}] \`${getNameTS(node.key)}${getParamsTS(node.value?.params)}${getReturnTS(node.value?.returnType)}\`${asyncMark}`);
            break;
        }
        case "PropertyDefinition": {
            const access = node.accessibility ? ` (${node.accessibility})` : "";
            lines.push(`${gap}- [prop] \`${node.key.name || getNameTS(node.key)}\`${access}`);
            break;
        }
        case "JSXElement": {
            const tagName = getNameTS(node.openingElement?.name) || "unknown";
            lines.push(`${gap}- **JSX**: \`<${tagName}>\``);
            if (node.children) {
                node.children.forEach(child => { lines = lines.concat(walkTSOutline(child, indent + 1)); });
            }
            break;
        }
        case "JSXFragment":
            lines.push(`${gap}- **JSX**: \`<Fragment>\``);
            if (node.children) {
                node.children.forEach(child => { lines = lines.concat(walkTSOutline(child, indent + 1)); });
            }
            break;
        case "ExpressionStatement":
            if (node.expression?.type === "CallExpression" && node.expression.callee?.name === "useEffect") {
                lines.push(`${gap}- **Hook**: \`useEffect\``);
            }
            break;
        case "ReturnStatement":
            lines.push(`${gap}- **Return**`);
            if (node.argument) lines = lines.concat(walkTSOutline(node.argument, indent + 1));
            break;
    }
    return lines;
};

// ==========================================
// 🎨 CSS PARSE LOGIC
// ==========================================
const walkCSSOutline = (rules) => {
    let lines = [];
    if (!rules) return lines;

    rules.forEach(rule => {
        const isInternalKey = (k) => k.startsWith('_') || k === 'length' || k === 'parentRule';

        if (rule.type === 'media') {
            lines.push(`* **Media: ${rule.media || "unknown"}**`);
            if (rule.rules) {
                rule.rules.forEach(subRule => {
                    if (subRule.selectors) {
                        lines.push(`  * \`${subRule.selectors.join(', ')}\``);
                    }
                    if (subRule.declarations) {
                        subRule.declarations.forEach(decl => {
                            if (decl.type === 'declaration' && !isInternalKey(decl.property)) {
                                lines.push(`    * ${decl.property}: ${decl.value}`);
                            }
                        });
                    }
                });
            }
        } else if (rule.type === 'rule') {
            if (rule.selectors) {
                lines.push(`* \`${rule.selectors.join(', ')}\``);
            }
            if (rule.declarations) {
                rule.declarations.forEach(decl => {
                    if (decl.type === 'declaration' && !isInternalKey(decl.property)) {
                        lines.push(`  * ${decl.property}: ${decl.value}`);
                    }
                });
            }
        }
    });
    return lines;
};

// ==========================================
// 🐘 PHP PARSE LOGIC (⚡ NEW ADDITION)
// ==========================================
const walkPHPOutline = (node, indent = 0) => {
    if (!node) return [];
    const gap = "  ".repeat(indent);
    let lines = [];

    // Map PHP architecture kinds safely
    switch (node.kind) {
        case "namespace":
            lines.push(`${gap}- **Namespace**: \`${node.name}\``);
            if (node.children) {
                node.children.forEach(child => { lines = lines.concat(walkPHPOutline(child, indent + 1)); });
            }
            break;

        case "usegroup":
            if (node.items) {
                node.items.forEach(item => {
                    lines.push(`${gap}- **Use**: \`${item.name}\``);
                });
            }
            break;

        case "class":
        case "interface":
        case "trait": {
            const typeLabel = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
            lines.push(`${gap}- **${typeLabel}**: \`${node.name}\``);
            if (node.body) {
                node.body.forEach(member => { lines = lines.concat(walkPHPOutline(member, indent + 1)); });
            }
            break;
        }

        case "method": {
            const visibility = node.visibility || "public";
            const isStatic = node.isStatic ? "static " : "";
            const params = node.arguments ? `(${node.arguments.map(a => `$${a.name}`).join(', ')})` : "()";
            lines.push(`${gap}- [method/${visibility}] \`${isStatic}${node.name}${params}\``);
            break;
        }

        case "property": {
            const visibility = node.visibility || "public";
            const isStatic = node.isStatic ? "static " : "";
            lines.push(`${gap}- [prop] \`${visibility} ${isStatic}$${node.name}\``);
            break;
        }

        case "function": {
            const params = node.arguments ? `(${node.arguments.map(a => `$${a.name}`).join(', ')})` : "()";
            lines.push(`${gap}- **Func**: \`${node.name}${params}\``);
            break;
        }

        case "constant":
            lines.push(`${gap}- **Const**: \`${node.name}\``);
            break;
    }
    return lines;
};

console.log(`Processing codebase targets for project [${PROJECT_NAME}]...`);

files.forEach(file => {
    const absolutePath = path.resolve(file).replace(/\\/g, '/');
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();
    
    try {
        const code = fs.readFileSync(absolutePath, 'utf-8');
        let outlineLines = [];

        if (ext === '.css') {
            const cssAst = cssParser.parse(code);
            if (cssAst.stylesheet && cssAst.stylesheet.rules) {
                outlineLines = walkCSSOutline(cssAst.stylesheet.rules);
            }
        } else if (ext === '.php') {
            // ⚡ PHP Router Flow Routing Integration
            const phpAst = phpEngine.parseCode(code, file);
            if (phpAst && phpAst.children) {
                phpAst.children.forEach(node => {
                    outlineLines = outlineLines.concat(walkPHPOutline(node, 0));
                });
            }
        } else {
            const ast = Parser.parse(code, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true
            });
            if (ast.body) {
                ast.body.forEach(node => {
                    outlineLines = outlineLines.concat(walkTSOutline(node, 0));
                });
            }
        }

        const markdownOutline = outlineLines.join('\n');
        fileOutlines[relativePath] = markdownOutline;

        const blockOutline = outlineLines
            .map(line => line.replace(/^\s*\*\s*\*\*/, (match) => match.replace('* **', '')).replace(/\*\*/g, ''))
            .join('\n');

        const encodedVault = encodeURIComponent(OBSIDIAN_VAULT_NAME || OBSIDIAN_VAULT_NAME);
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

# Codebase Outline: ${relativePath}

### File Metadata Parameters
* **Project Reference:** \`${PROJECT_NAME}\`
* **Local System Path:** \`${absolutePath}\`

## Codebase Nested Tree Outline View
${markdownOutline || '*No trackable outline metrics found within this file module.*'}

## Structural Text Block View

\`\`\`anyblock
[list2node]
${markdownOutline || '// No structural definitions'}
\`\`\`
`;

        const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
        fs.writeFileSync(path.join(BASE_OUTPUT_DIR, safeFileName), markdownWrapper, 'utf-8');

    } catch (err) {
        console.error(`❌ Parse execution failure on module target ${relativePath}:`, err.message);
    }
});

// 3. Compile master catalog compilation overview doc
let masterContent = `# Codebase Structural Outline Index

---

## Workspace Layout Directory Manifest
`;

Object.keys(fileOutlines).forEach(relativePath => {
    const safeFileName = relativePath.replace(/[\/\\:\*\?"<>\|]/g, '_') + '.md';
    const componentMdPath = path.join(BASE_OUTPUT_DIR, safeFileName);
    const componentMdUri = `file://${path.resolve(componentMdPath).replace(/\\/g, '/')}`;

    const cleanBlockLines = fileOutlines[relativePath]
        ? fileOutlines[relativePath].split('\n').map(line => line.replace(/^\s*\*\s*\*\*/, (match) => match.replace('* **', '')).replace(/\*\规则/g, '').replace(/\*\*/g, '')).join('\n')
        : '// Empty';

    masterContent += `\n### 📄 Module Map Summary: \`${relativePath}\`
* **Isolated AST Map Document:** [Open Advanced Workspace View](${componentMdUri})

#### Codebase Layout Structural Outline Profile
${fileOutlines[relativePath] ? fileOutlines[relativePath] : '  * *Empty Module Schema*'}

#### Code Structure Custom Block Preview
\`\`\`anyblock
[list2node]
${cleanBlockLines}
\`\`\`

---
`;
});

masterContent += `\n*Generated automatically on ${new Date().toLocaleString()}*`;

const docMdPath = path.join(BASE_OUTPUT_DIR, 'DOC.md');
fs.writeFileSync(docMdPath, masterContent, 'utf-8');

console.log('\n========= UNIFIED EXTENSION PARSER COMPLETE =========');
console.log(`✔ Isolated Structural Files Mapped   -> ${Object.keys(fileOutlines).length} targets compiled`);
console.log(`✔ Master Catalog Documentation Doc  -> ${docMdPath}`);
console.log('===========================================================');
