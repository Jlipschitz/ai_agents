import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const MAX_FILE_BYTES = 1024 * 1024;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'coordination', 'coordination-two', 'artifacts', 'coverage', 'dist', 'build', '.next']);
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.br', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.avi', '.exe', '.dll', '.bin']);
const PLACEHOLDER_WORDS = ['example', 'sample', 'placeholder', 'replace-me', 'changeme', 'dummy', 'test-token', 'your_', '<', 'xxx'];
const RULES = [
  { id: 'private-key', severity: 'high', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'openai-key', severity: 'high', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'github-token', severity: 'high', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g },
  { id: 'aws-access-key', severity: 'high', pattern: /\bA(KIA|SIA)[0-9A-Z]{16}\b/g },
  { id: 'slack-token', severity: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'generic-secret-assignment', severity: 'medium', pattern: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{12,}["']/gi },
];

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function splitPaths(value) {
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function isPlaceholder(match) {
  const lower = String(match ?? '').toLowerCase();
  return PLACEHOLDER_WORDS.some((word) => lower.includes(word));
}

function redact(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ');
  if (text.length <= 14) return '[redacted]';
  return `${text.slice(0, 6)}...[redacted]...${text.slice(-4)}`;
}

function gitList(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function shouldSkipPath(relativePath) {
  const parts = normalizePath(relativePath).split('/');
  return parts.some((part) => EXCLUDED_DIRS.has(part));
}

function shouldSkipFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
}

function enumeratePath(root, inputPath, files, skipped) {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const relativePath = normalizePath(absolutePath, root);
  if (!fs.existsSync(absolutePath)) {
    skipped.push({ path: relativePath || inputPath, reason: 'missing' });
    return;
  }
  if (shouldSkipPath(relativePath)) {
    skipped.push({ path: relativePath, reason: 'excluded' });
    return;
  }
  const stats = fs.statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      enumeratePath(root, path.join(absolutePath, entry.name), files, skipped);
    }
    return;
  }
  if (!stats.isFile()) return;
  if (shouldSkipFile(absolutePath)) {
    skipped.push({ path: relativePath, reason: 'binary-extension' });
    return;
  }
  if (stats.size > MAX_FILE_BYTES) {
    skipped.push({ path: relativePath, reason: 'too-large' });
    return;
  }
  files.push(relativePath);
}

function collectTargetFiles(root, argv, board) {
  const skipped = [];
  const explicitPaths = [
    ...splitPaths(getFlagValue(argv, '--paths', '')),
    ...getPositionals(argv, new Set(['--paths'])),
  ];
  const staged = hasFlag(argv, '--staged');
  let targets = explicitPaths;
  if (!targets.length && staged) targets = gitList(root, ['diff', '--cached', '--name-only']);
  if (!targets.length) targets = gitList(root, ['ls-files']);
  if (!targets.length) {
    targets = Array.isArray(board?.tasks)
      ? board.tasks.flatMap((task) => Array.isArray(task.claimedPaths) ? task.claimedPaths : [])
      : ['.'];
  }

  const files = [];
  for (const target of unique(targets)) enumeratePath(root, target, files, skipped);
  return { files: unique(files), skipped };
}

function scanFile(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineFindings = [];
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(line);
      while (match) {
        if (!isPlaceholder(match[0])) {
          lineFindings.push({
            path: relativePath,
            line: lineIndex + 1,
            column: match.index + 1,
            rule: rule.id,
            severity: rule.severity,
            preview: redact(match[0]),
          });
        }
        match = rule.pattern.exec(line);
      }
    }
    const hasHighConfidenceFinding = lineFindings.some((finding) => finding.severity === 'high');
    findings.push(...(hasHighConfidenceFinding ? lineFindings.filter((finding) => finding.rule !== 'generic-secret-assignment') : lineFindings));
  }
  return findings;
}

export function buildSecretsScan(context, argv = []) {
  const root = context.root || process.cwd();
  const { files, skipped } = collectTargetFiles(root, argv, context.board);
  const findings = [];
  for (const filePath of files) {
    try {
      findings.push(...scanFile(root, filePath));
    } catch (error) {
      skipped.push({ path: filePath, reason: `unreadable: ${error.message}` });
    }
  }
  const summary = {
    scannedFiles: files.length,
    skippedFiles: skipped.length,
    findings: findings.length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
  };
  return {
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    strict: hasFlag(argv, '--strict'),
    staged: hasFlag(argv, '--staged'),
    paths: unique([...splitPaths(getFlagValue(argv, '--paths', '')), ...getPositionals(argv, new Set(['--paths']))]).map(stringValue).filter(Boolean),
    summary,
    findings,
    skipped,
  };
}

function renderSecretsScan(report) {
  const lines = ['# Secrets Scan'];
  lines.push(`Scanned: ${report.summary.scannedFiles} file(s); skipped: ${report.summary.skippedFiles}; findings: ${report.summary.findings}; high: ${report.summary.high}; medium: ${report.summary.medium}; low: ${report.summary.low}`);
  if (!report.findings.length) {
    lines.push('- no likely secrets found');
    return lines.join('\n');
  }
  for (const finding of report.findings.slice(0, 50)) {
    lines.push(`- [${finding.severity}] ${finding.rule}: ${finding.path}:${finding.line}:${finding.column} ${finding.preview}`);
  }
  if (report.findings.length > 50) lines.push(`- ... ${report.findings.length - 50} more finding(s)`);
  return lines.join('\n');
}

export function runSecretsScan(argv, context) {
  const report = buildSecretsScan(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderSecretsScan(report));
  return report.strict && report.findings.length ? 1 : 0;
}
