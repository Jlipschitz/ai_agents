#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOTS = ['bin', 'scripts', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'coordination', 'coordination-two', 'artifacts', 'coverage', 'dist', 'build']);
const KNOWN_TAGS = new Set([
  'arg',
  'argument',
  'deprecated',
  'example',
  'param',
  'private',
  'prop',
  'property',
  'returns',
  'return',
  'throws',
  'type',
  'typedef',
]);
const TYPE_TAGS = new Set(['arg', 'argument', 'param', 'prop', 'property', 'returns', 'return', 'throws', 'type', 'typedef']);
const NAMED_TYPE_TAGS = new Set(['arg', 'argument', 'param', 'prop', 'property']);

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function normalizePath(root, filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function parsePathList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseJsdocArgs(argv) {
  const parsed = { paths: [], json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--paths') {
      index += 1;
      parsed.paths.push(...parsePathList(argv[index]));
    } else if (arg.startsWith('--paths=')) {
      parsed.paths.push(...parsePathList(arg.slice('--paths='.length)));
    } else {
      parsed.paths.push(arg);
    }
  }

  return parsed;
}

function collectSourceFiles(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(path.extname(absolutePath)) ? [absolutePath] : [];
  if (!stat.isDirectory()) return [];
  if (SKIP_DIRECTORIES.has(path.basename(absolutePath))) return [];

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectSourceFiles(root, path.join(relativePath, entry.name)));
}

function lineColumnForOffset(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/u);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function cleanBlockLines(block) {
  return block
    .replace(/^\/\*\*/u, '')
    .replace(/\*\/$/u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\* ?/u, '').trimEnd());
}

function readBracedType(value) {
  if (!value.startsWith('{')) return { ok: false, reason: 'missing type braces' };
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const typeValue = value.slice(1, index).trim();
        if (!typeValue) return { ok: false, reason: 'empty type' };
        return { ok: true, typeValue, rest: value.slice(index + 1).trim() };
      }
    }
  }
  return { ok: false, reason: 'unbalanced type braces' };
}

function addIssue(issues, filePath, source, offset, rule, message) {
  const location = lineColumnForOffset(source, offset);
  issues.push({ file: filePath, line: location.line, column: location.column, rule, message });
}

function validateTagLine(issues, filePath, source, lineOffset, tag, value) {
  if (!KNOWN_TAGS.has(tag)) {
    addIssue(issues, filePath, source, lineOffset, 'jsdoc-known-tag', `Unknown JSDoc tag "@${tag}".`);
    return;
  }

  if (!TYPE_TAGS.has(tag)) return;

  const parsedType = readBracedType(value.trim());
  if (!parsedType.ok) {
    addIssue(issues, filePath, source, lineOffset, 'jsdoc-type-braces', `@${tag} must include a valid braced type: ${parsedType.reason}.`);
    return;
  }

  if (NAMED_TYPE_TAGS.has(tag) && !parsedType.rest) {
    addIssue(issues, filePath, source, lineOffset, 'jsdoc-param-name', `@${tag} must include a parameter or property name after the type.`);
  }
}

function validateJsdocBlock(filePath, source, match) {
  const issues = [];
  const block = match[0];
  const blockStart = match.index;
  const lines = cleanBlockLines(block);
  let cursor = blockStart;

  for (const line of block.split(/\r?\n/u)) {
    const cleanedLine = line.replace(/^\s*\* ?/u, '').trim();
    const tagMatch = /^@([a-zA-Z][\w-]*)(?:\s+(.*))?$/u.exec(cleanedLine);
    if (tagMatch) {
      validateTagLine(issues, filePath, source, cursor + line.indexOf('@'), tagMatch[1], tagMatch[2] ?? '');
    }
    cursor += line.length + 1;
  }

  if (!lines.some((line) => line.trim())) {
    addIssue(issues, filePath, source, blockStart, 'jsdoc-empty-block', 'JSDoc block must include a description or tags.');
  }

  return issues;
}

function validateFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  const pattern = /\/\*\*[\s\S]*?\*\//gu;
  let match = pattern.exec(source);
  let blockCount = 0;

  while (match) {
    blockCount += 1;
    issues.push(...validateJsdocBlock(filePath, source, match));
    match = pattern.exec(source);
  }

  return { blockCount, issues };
}

export function buildJsdocReport(options = {}) {
  const root = path.resolve(options.root ?? REPO_ROOT);
  const requestedPaths = options.paths?.length ? options.paths : DEFAULT_ROOTS;
  const files = [...new Set(requestedPaths.flatMap((entry) => collectSourceFiles(root, entry)).map((entry) => path.resolve(entry)))]
    .sort((left, right) => left.localeCompare(right));
  const fileResults = files.map((filePath) => validateFile(filePath));
  const issues = fileResults.flatMap((result) => result.issues);

  return {
    ok: issues.length === 0,
    root,
    filesScanned: files.length,
    blocksScanned: fileResults.reduce((total, result) => total + result.blockCount, 0),
    issues: issues.map((issue) => ({ ...issue, file: normalizePath(root, issue.file) })),
  };
}

export function runJsdocCheck(argv = process.argv.slice(2), options = {}) {
  const parsed = parseJsdocArgs(argv);
  const report = buildJsdocReport({ root: options.root, paths: parsed.paths });
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    stdout.write(`JSDoc OK: ${report.filesScanned} file(s), ${report.blocksScanned} block(s).\n`);
  } else {
    stderr.write(`JSDoc validation failed: ${report.issues.length} issue(s) across ${new Set(report.issues.map((issue) => issue.file)).size} file(s).\n`);
    for (const issue of report.issues) {
      stderr.write(`${issue.file}:${issue.line}:${issue.column} ${issue.rule}: ${issue.message}\n`);
    }
  }

  return report.ok ? 0 : 1;
}

if (isCliEntrypoint()) {
  process.exitCode = runJsdocCheck();
}
