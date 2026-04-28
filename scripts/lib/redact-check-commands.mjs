import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { buildHandoffBundle } from './handoff-bundle-commands.mjs';
import { normalizePath } from './path-utils.mjs';
import { getPrivacyOptions } from './privacy-utils.mjs';
import { buildAgentPrompt } from './prompt-commands.mjs';
import { redactSecretPreview, scanTextForSecrets } from './secrets-scan-commands.mjs';

const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.markdown', '.ndjson', '.txt', '.log']);
const GENERATED_TASK_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff', 'done', 'released']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', '.next']);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function splitPaths(value) {
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function isInsideRoot(root, absolutePath) {
  const relativePath = path.relative(root, absolutePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function shouldSkipDirectory(filePath) {
  return normalizePath(filePath).split('/').some((part) => SKIP_DIRECTORIES.has(part));
}

function enumerateTarget(root, inputPath, files, skipped) {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
  const relativePath = normalizePath(absolutePath, root) || normalizePath(inputPath);
  if (!isInsideRoot(root, absolutePath)) {
    skipped.push({ path: relativePath || inputPath, reason: 'outside-root' });
    return;
  }
  if (!fs.existsSync(absolutePath)) {
    skipped.push({ path: relativePath || inputPath, reason: 'missing' });
    return;
  }
  if (shouldSkipDirectory(relativePath)) {
    skipped.push({ path: relativePath, reason: 'excluded' });
    return;
  }

  const stats = fs.statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      enumerateTarget(root, path.join(absolutePath, entry.name), files, skipped);
    }
    return;
  }
  if (!stats.isFile()) return;
  if (!isTextFile(absolutePath)) {
    skipped.push({ path: relativePath, reason: 'non-text-extension' });
    return;
  }
  if (stats.size > MAX_FILE_BYTES) {
    skipped.push({ path: relativePath, reason: 'too-large' });
    return;
  }
  files.add(relativePath);
}

function existingDefaultTargets(root, context) {
  const paths = context.paths ?? {};
  return [
    paths.boardPath,
    paths.journalPath,
    paths.messagesPath,
    paths.tasksRoot,
    path.join(root, 'artifacts', 'releases'),
  ].filter((target) => target && fs.existsSync(target));
}

function collectTargetFiles(root, context, argv) {
  const skipped = [];
  const explicitTargets = [
    ...splitPaths(getFlagValue(argv, '--paths', '')),
    ...getPositionals(argv, new Set(['--paths'])),
  ];
  const targets = explicitTargets.length ? explicitTargets : existingDefaultTargets(root, context);
  const files = new Set();
  for (const target of unique(targets)) enumerateTarget(root, target, files, skipped);
  return { files: [...files].sort((left, right) => left.localeCompare(right)), skipped };
}

export function scanTextForRedactPatterns(text, patterns, sourcePath = '<text>', source = 'file') {
  const findings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  const normalizedPatterns = unique(stringArray(patterns));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lowerLine = line.toLowerCase();
    for (const pattern of normalizedPatterns) {
      const lowerPattern = pattern.toLowerCase();
      let index = lowerLine.indexOf(lowerPattern);
      while (index >= 0) {
        findings.push({
          kind: 'redact-pattern',
          source,
          path: sourcePath,
          line: lineIndex + 1,
          column: index + 1,
          rule: 'redact-pattern',
          pattern,
          severity: 'medium',
          preview: redactSecretPreview(line),
        });
        index = lowerLine.indexOf(lowerPattern, index + lowerPattern.length);
      }
    }
  }
  return findings;
}

function scanText(text, sourcePath, source, patterns) {
  const secretFindings = scanTextForSecrets(text, sourcePath).map((finding) => ({
    ...finding,
    kind: 'secret',
    source,
  }));
  return [
    ...secretFindings,
    ...scanTextForRedactPatterns(text, patterns, sourcePath, source),
  ];
}

function readFileSource(root, relativePath, patterns, skipped) {
  try {
    const text = fs.readFileSync(path.resolve(root, relativePath), 'utf8');
    return scanText(text, relativePath, 'file', patterns);
  } catch (error) {
    skipped.push({ path: relativePath, reason: `unreadable: ${error.message}` });
    return [];
  }
}

function taskTitle(task) {
  return task?.title || task?.summary || task?.id || 'unknown task';
}

function buildTaskSummaryText(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const lines = ['# Generated Task Summary'];
  for (const task of tasks.filter((entry) => GENERATED_TASK_STATUSES.has(entry?.status))) {
    lines.push(`- ${task.id}: ${taskTitle(task)} (${task.status || 'unknown'})`);
    if (task.summary) lines.push(`  summary: ${task.summary}`);
    if (task.rationale) lines.push(`  rationale: ${task.rationale}`);
    if (task.ownerId) lines.push(`  owner: ${task.ownerId}`);
    if (Array.isArray(task.claimedPaths) && task.claimedPaths.length) lines.push(`  paths: ${task.claimedPaths.join(', ')}`);
    if (Array.isArray(task.relevantDocs) && task.relevantDocs.length) lines.push(`  docs: ${task.relevantDocs.join(', ')}`);
    if (Array.isArray(task.notes)) {
      for (const note of task.notes.slice(-3)) lines.push(`  note: ${note?.body ?? ''}`);
    }
    if (Array.isArray(task.verificationLog)) {
      for (const entry of task.verificationLog.slice(-3)) lines.push(`  verification: ${entry?.check ?? 'check'} ${entry?.outcome ?? entry?.status ?? ''} ${entry?.details ?? ''}`);
    }
  }
  return lines.join('\n');
}

function promptTargets(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const agents = Array.isArray(board?.agents) ? board.agents : [];
  const targets = [];
  const seen = new Set();
  const addTarget = (agentId, taskId = '') => {
    if (!agentId) return;
    const key = `${agentId}:${taskId}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ agentId, taskId });
  };

  for (const agent of agents) addTarget(agent?.id, agent?.taskId ?? '');
  for (const task of tasks.filter((entry) => entry?.ownerId && GENERATED_TASK_STATUSES.has(entry?.status))) {
    addTarget(task.ownerId, task.id);
  }
  return targets;
}

function collectGeneratedSources(board) {
  const sources = [{ path: 'generated:task-summary', text: buildTaskSummaryText(board) }];
  for (const target of promptTargets(board)) {
    const prompt = buildAgentPrompt(board, target.agentId, target.taskId);
    if (prompt.ok) sources.push({ path: `generated:prompt:${target.agentId}:${prompt.taskId}`, text: prompt.prompt });
    if (target.taskId) {
      const bundle = buildHandoffBundle(board, target.agentId, target.taskId);
      if (bundle.ok) sources.push({ path: `generated:handoff-bundle:${target.agentId}:${target.taskId}`, text: bundle.bundle });
    }
  }
  return sources;
}

function summarize(findings, files, generatedSources, skipped) {
  return {
    sources: files.length + generatedSources.length,
    fileSources: files.length,
    generatedSources: generatedSources.length,
    skipped: skipped.length,
    findings: findings.length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
  };
}

export function buildRedactCheck(context, argv = []) {
  const root = context.root || process.cwd();
  const privacy = getPrivacyOptions(context.config);
  const { files, skipped } = collectTargetFiles(root, context, argv);
  const findings = [];
  for (const filePath of files) findings.push(...readFileSource(root, filePath, privacy.redactPatterns, skipped));

  const generatedSources = hasFlag(argv, '--state-only') ? [] : collectGeneratedSources(context.board);
  for (const source of generatedSources) {
    findings.push(...scanText(source.text, source.path, 'generated', privacy.redactPatterns));
  }

  return {
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    strict: hasFlag(argv, '--strict'),
    stateOnly: hasFlag(argv, '--state-only'),
    privacy,
    paths: unique([...splitPaths(getFlagValue(argv, '--paths', '')), ...getPositionals(argv, new Set(['--paths']))]),
    summary: summarize(findings, files, generatedSources, skipped),
    findings,
    skipped,
  };
}

function renderRedactCheck(report) {
  const lines = ['# Redact Check'];
  lines.push(`Sources: ${report.summary.sources} (${report.summary.fileSources} file, ${report.summary.generatedSources} generated); skipped: ${report.summary.skipped}; findings: ${report.summary.findings}; high: ${report.summary.high}; medium: ${report.summary.medium}; low: ${report.summary.low}`);
  if (!report.findings.length) {
    lines.push('- no sensitive values found');
  } else {
    for (const finding of report.findings.slice(0, 50)) {
      const pattern = finding.pattern ? `:${finding.pattern}` : '';
      lines.push(`- [${finding.severity}] ${finding.rule}${pattern}: ${finding.path}:${finding.line}:${finding.column} ${finding.preview}`);
    }
    if (report.findings.length > 50) lines.push(`- ... ${report.findings.length - 50} more finding(s)`);
  }
  if (report.skipped.length) {
    lines.push('', 'Skipped:');
    for (const entry of report.skipped.slice(0, 20)) lines.push(`- ${entry.path}: ${entry.reason}`);
    if (report.skipped.length > 20) lines.push(`- ... ${report.skipped.length - 20} more skipped path(s)`);
  }
  return lines.join('\n');
}

export function runRedactCheck(argv, context) {
  const report = buildRedactCheck(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderRedactCheck(report));
  return report.strict && report.findings.length ? 1 : 0;
}
