/**
 * Find identifiers that are REFERENCED but never declared, imported, or global.
 *
 * The build cannot do this — esbuild performs no scope analysis, so a leftover
 * call to a helper that was deleted (exactly what happened to `decrypt` in
 * StarredPage) ships green and throws at runtime. This strips JSX with vite's
 * esbuild transform, parses the result with vite's real AST parser, then checks
 * every reference against every binding declared anywhere in the module.
 *
 * Module-level rather than per-scope on purpose: a name declared in ANY scope of
 * the file is assumed reachable. That under-reports (a name declared in a sibling
 * function still counts) but never invents a hit, which is what matters when the
 * output is a list of suspected runtime crashes.
 *
 * Run from /client:  node scan-undefined.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { transformWithOxc, parseAstAsync } from 'vite';

const ROOT = path.resolve('src');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'console',
  'Date', 'Math', 'JSON', 'Boolean', 'String', 'Number', 'Array', 'Object', 'Symbol',
  'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'BigInt',
  'undefined', 'NaN', 'Infinity', 'globalThis', 'URL', 'URLSearchParams', 'Intl',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask',
  'crypto', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'Headers', 'Request', 'Response',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'RegExp', 'Function', 'Blob', 'File',
  'FileReader', 'FormData', 'Notification', 'Audio', 'Image', 'Option', 'Worker',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'performance',
  'matchMedia', 'getComputedStyle', 'scrollTo', 'alert', 'confirm', 'prompt',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'AbortController', 'AbortSignal',
  'CustomEvent', 'Event', 'EventTarget', 'MediaRecorder', 'RTCPeerConnection', 'RTCSessionDescription',
  'RTCIceCandidate', 'MediaStream', 'ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Float32Array', 'Float64Array', 'DataView', 'Buffer', 'process', 'module',
  'require', 'exports', '__dirname', '__filename', 'import_meta', 'React', 'JSX',
  'CSS', 'DOMParser', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Element', 'HTMLElement', 'Node',
  'HTMLMediaElement', 'HTMLVideoElement', 'HTMLAudioElement', 'HTMLCanvasElement', 'HTMLInputElement',
  // Injected by the JSX transform itself, or part of `import.meta` — artifacts of
  // the transform, not references the source ever made.
  'jsx', 'jsxs', 'jsxDEV', 'jsxsDEV', 'Fragment', 'createElement', 'import', 'meta',
]);

/** Every binding name introduced by a declaration node, at any depth. */
function collectPattern(node, out) {
  if (!node || typeof node !== 'object') return;
  switch (node.type) {
    case 'Identifier':
      out.add(node.name);
      return;
    case 'ObjectPattern':
      for (const p of node.properties) collectPattern(p.type === 'RestElement' ? p.argument : p.value, out);
      return;
    case 'ArrayPattern':
      for (const el of node.elements) collectPattern(el, out);
      return;
    case 'AssignmentPattern':
      collectPattern(node.left, out);
      return;
    case 'RestElement':
      collectPattern(node.argument, out);
      return;
    default:
  }
}

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkAst(n, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    walkAst(node[key], visit);
  }
}

let problems = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let code;
  try {
    ({ code } = await transformWithOxc(source, file, { lang: file.endsWith('.jsx') ? 'jsx' : 'js' }));
  } catch (err) {
    console.log(`${path.relative('.', file)}  PARSE FAILED: ${err.message.split('\n')[0]}`);
    problems += 1;
    continue;
  }

  let ast;
  try {
    ast = await parseAstAsync(code);
  } catch (err) {
    console.log(`${path.relative('.', file)}  AST FAILED: ${err.message.split('\n')[0]}`);
    problems += 1;
    continue;
  }

  const bound = new Set();
  const referenced = new Map(); // name -> first offset

  walkAst(ast, (node) => {
    switch (node.type) {
      case 'VariableDeclarator':
        collectPattern(node.id, bound);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) bound.add(node.id.name);
        for (const p of node.params || []) collectPattern(p, bound);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) bound.add(node.id.name);
        break;
      case 'CatchClause':
        if (node.param) collectPattern(node.param, bound);
        break;
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        bound.add(node.local.name);
        break;
      case 'ImportSpecifier':
        bound.add(node.local.name);
        break;
      case 'LabeledStatement':
        bound.add(node.label.name);
        break;
      default:
    }
  });

  // Second pass: references. Skip property keys, member properties, labels.
  walkAst(ast, (node) => {
    /* `import { QrCode as QrCodeIcon }` binds QrCodeIcon; QrCode is the name in
       the OTHER module, never a local reference. Without this every aliased
       import is reported as undefined. */
    if (node.type === 'ImportSpecifier' && node.imported?.type === 'Identifier') {
      node.imported.__skip = true;
    }
    if (node.type === 'ExportSpecifier') {
      if (node.local?.type === 'Identifier') node.local.__skip = true;
      if (node.exported?.type === 'Identifier') node.exported.__skip = true;
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      node.property.__skip = true;
    }
    if (node.type === 'Property' && !node.computed && node.key?.type === 'Identifier') {
      node.key.__skip = true;
    }
    if (node.type === 'MethodDefinition' && !node.computed && node.key?.type === 'Identifier') {
      node.key.__skip = true;
    }
    if (node.type === 'Identifier' && !node.__skip && !referenced.has(node.name)) {
      referenced.set(node.name, node.start);
    }
  });

  for (const [name, offset] of referenced) {
    if (bound.has(name) || GLOBALS.has(name)) continue;
    const line = code.slice(0, offset).split('\n').length;
    console.log(`${path.relative('.', file).replace(/\\/g, '/')}  "${name}" is referenced but never declared or imported (transformed line ~${line})`);
    problems += 1;
  }
}

console.log(problems ? `\n${problems} undefined reference(s)` : '\nno undefined references');
// Non-zero so CI actually FAILS on a hit rather than printing one into a green log.
if (problems) process.exitCode = 1;
