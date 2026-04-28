#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOTS = ['bin', 'scripts', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const RESOLUTION_EXTENSIONS = ['', '.mjs', '.js', '.cjs', '.json'];
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'coordination', 'coordination-two', 'artifacts', 'coverage', 'dist', 'build']);
const CORE_MODULES = new Set(builtinModules.map((entry) => entry.replace(/^node:/, '')));

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

export function parseLintArgs(argv) {
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

  const directoryName = path.basename(absolutePath);
  if (SKIP_DIRECTORIES.has(directoryName)) return [];

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectSourceFiles(root, path.join(relativePath, entry.name)));
}

function lineColumnForOffset(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/u);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function addIssue(issues, filePath, source, index, rule, message) {
  const location = lineColumnForOffset(source, index);
  issues.push({
    file: filePath,
    line: location.line,
    column: location.column,
    rule,
    message,
  });
}

function findImportSpecifiers(source) {
  const specifiers = [];
  const importExportPattern = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gmu;
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

  for (const pattern of [importExportPattern, dynamicImportPattern]) {
    let match = pattern.exec(source);
    while (match) {
      specifiers.push({ value: match[1], index: match.index });
      match = pattern.exec(source);
    }
  }

  return specifiers.sort((left, right) => left.index - right.index);
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isCoreSpecifier(specifier) {
  return CORE_MODULES.has(specifier) || (specifier.startsWith('node:') && CORE_MODULES.has(specifier.slice('node:'.length)));
}

function resolveRelativeImport(filePath, specifier) {
  const basePath = path.resolve(path.dirname(filePath), specifier);
  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function lintFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const issues = [];

  for (const specifier of findImportSpecifiers(source)) {
    if (isRelativeSpecifier(specifier.value)) {
      if (!resolveRelativeImport(filePath, specifier.value)) {
        addIssue(issues, filePath, source, specifier.index, 'relative-import-exists', `Relative import "${specifier.value}" does not resolve to a file.`);
      }
      continue;
    }

    if (isCoreSpecifier(specifier.value) && !specifier.value.startsWith('node:')) {
      addIssue(issues, filePath, source, specifier.index, 'node-protocol-import', `Use "node:${specifier.value}" for Node core module imports.`);
    }
  }

  return issues;
}

export function buildLintReport(options = {}) {
  const root = path.resolve(options.root ?? REPO_ROOT);
  const requestedPaths = options.paths?.length ? options.paths : DEFAULT_ROOTS;
  const files = [...new Set(requestedPaths.flatMap((entry) => collectSourceFiles(root, entry)).map((entry) => path.resolve(entry)))]
    .sort((left, right) => left.localeCompare(right));
  const issues = files.flatMap((filePath) => lintFile(filePath));

  return {
    ok: issues.length === 0,
    root,
    filesScanned: files.length,
    issues: issues.map((issue) => ({ ...issue, file: normalizePath(root, issue.file) })),
  };
}

export function runLint(argv = process.argv.slice(2), options = {}) {
  const parsed = parseLintArgs(argv);
  const report = buildLintReport({ root: options.root, paths: parsed.paths });
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    stdout.write(`Lint OK: ${report.filesScanned} file(s).\n`);
  } else {
    stderr.write(`Lint failed: ${report.issues.length} issue(s) across ${new Set(report.issues.map((issue) => issue.file)).size} file(s).\n`);
    for (const issue of report.issues) {
      stderr.write(`${issue.file}:${issue.line}:${issue.column} ${issue.rule}: ${issue.message}\n`);
    }
  }

  return report.ok ? 0 : 1;
}

if (isCliEntrypoint()) {
  process.exitCode = runLint();
}
