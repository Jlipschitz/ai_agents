import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const DEFAULT_TARGETS = ['package.json', 'agent-coordination.config.json', 'agent-coordination.schema.json', 'docs', 'scripts', 'tests', 'bin'];
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'coordination', 'coordination-two', 'artifacts', 'coverage', 'dist', 'build']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);

function splitPaths(value) {
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function shouldSkip(relativePath) {
  return normalizePath(relativePath).split('/').some((part) => EXCLUDED_DIRS.has(part));
}

function collectFile(root, inputPath, files) {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const relativePath = normalizePath(absolutePath, root);
  if (!fs.existsSync(absolutePath) || shouldSkip(relativePath)) return;
  const stats = fs.statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      collectFile(root, path.join(absolutePath, entry.name), files);
    }
    return;
  }
  if (!stats.isFile()) return;
  if (!TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) return;
  files.push(relativePath);
}

function collectFiles(root, argv) {
  const targets = unique([
    ...splitPaths(getFlagValue(argv, '--paths', '')),
    ...getPositionals(argv, new Set(['--paths'])),
  ]);
  const files = [];
  for (const target of targets.length ? targets : DEFAULT_TARGETS) collectFile(root, target, files);
  return unique(files);
}

function normalizeText(text) {
  return `${text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\s*$/g, '')}\n`;
}

function formatJson(text, filePath) {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON: ${error.message}`);
  }
}

function formattedContent(filePath, content) {
  if (path.extname(filePath).toLowerCase() === '.json') return formatJson(content, filePath);
  return normalizeText(content);
}

export function buildFormatPlan(context, argv = []) {
  const root = context.root || process.cwd();
  const files = collectFiles(root, argv);
  const changes = [];
  const errors = [];
  for (const filePath of files) {
    const absolutePath = path.resolve(root, filePath);
    const before = fs.readFileSync(absolutePath, 'utf8');
    try {
      const after = formattedContent(filePath, before);
      if (after !== before) changes.push({ path: filePath, bytesBefore: Buffer.byteLength(before), bytesAfter: Buffer.byteLength(after) });
    } catch (error) {
      errors.push(error.message);
    }
  }
  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    apply: hasFlag(argv, '--apply'),
    check: hasFlag(argv, '--check'),
    summary: { scannedFiles: files.length, changedFiles: changes.length, errors: errors.length },
    changes,
    errors,
  };
}

function applyFormatPlan(context, argv, plan) {
  const root = context.root || process.cwd();
  for (const change of plan.changes) {
    const absolutePath = path.resolve(root, change.path);
    const before = fs.readFileSync(absolutePath, 'utf8');
    fs.writeFileSync(absolutePath, formattedContent(change.path, before));
  }
}

function renderFormatPlan(plan) {
  const lines = ['# Format'];
  lines.push(`Scanned: ${plan.summary.scannedFiles}; changed: ${plan.summary.changedFiles}; errors: ${plan.summary.errors}`);
  if (plan.errors.length) lines.push(plan.errors.map((error) => `- error: ${error}`).join('\n'));
  if (!plan.changes.length) {
    lines.push('- all files already formatted');
    return lines.join('\n');
  }
  lines.push(plan.changes.map((change) => `- ${change.path}`).join('\n'));
  return lines.join('\n');
}

export function runFormat(argv, context) {
  const json = hasFlag(argv, '--json');
  const plan = buildFormatPlan(context, argv);
  if (plan.apply && plan.ok) applyFormatPlan(context, argv, plan);
  const payload = { ...plan, applied: plan.apply && plan.ok };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else console.log(renderFormatPlan(payload));
  if (!plan.ok) return 1;
  if (plan.check && plan.changes.length) return 1;
  return 0;
}
