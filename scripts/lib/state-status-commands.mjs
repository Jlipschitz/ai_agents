import fs from 'node:fs';
import path from 'node:path';

import { hasFlag } from './args-utils.mjs';
import { buildWorkspaceHealth } from './health-score-commands.mjs';
import { normalizePath } from './path-utils.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff']);

function fileSize(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { exists: false, sizeBytes: 0 };
  return { exists: true, sizeBytes: fs.statSync(filePath).size };
}

function listFilesRecursive(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(filePath);
    return entry.isFile() ? [filePath] : [];
  });
}

function directorySize(dirPath) {
  const files = listFilesRecursive(dirPath);
  return {
    exists: fs.existsSync(dirPath),
    files: files.length,
    sizeBytes: files.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
  };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function sizeEntry(label, filePath) {
  const size = fileSize(filePath);
  return {
    label,
    path: filePath,
    exists: size.exists,
    sizeBytes: size.sizeBytes,
  };
}

export function buildStateSizeReport(context) {
  const paths = context.paths;
  const artifactIndexPath = path.join(context.root, 'artifacts', 'checks', 'index.ndjson');
  const files = [
    sizeEntry('board', paths.boardPath),
    sizeEntry('journal', paths.journalPath),
    sizeEntry('messages', paths.messagesPath),
    sizeEntry('artifactIndex', artifactIndexPath),
  ];
  const runtime = directorySize(paths.runtimeRoot);
  const coordinationTotalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0) + runtime.sizeBytes;
  const maxArtifactMb = Number(context.config?.artifacts?.maxMb);
  const recommendations = [];

  const boardSize = files.find((file) => file.label === 'board')?.sizeBytes ?? 0;
  const journalSize = files.find((file) => file.label === 'journal')?.sizeBytes ?? 0;
  const messagesSize = files.find((file) => file.label === 'messages')?.sizeBytes ?? 0;
  if (boardSize > 250 * 1024 || journalSize > 1024 * 1024 || messagesSize > 512 * 1024) {
    recommendations.push('Run compact-state to archive old coordination history.');
  }
  if (Number.isFinite(maxArtifactMb) && maxArtifactMb > 0) {
    const artifactBytes = directorySize(path.join(context.root, 'artifacts')).sizeBytes;
    if (artifactBytes > maxArtifactMb * 1024 * 1024) recommendations.push('Run artifacts prune to reduce artifact storage.');
  }
  if (!recommendations.length) recommendations.push('No state-size cleanup is currently recommended.');

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    files,
    runtime,
    coordinationTotalBytes,
    recommendations,
  };
}

function renderStateSize(report) {
  const lines = ['# State Size'];
  for (const file of report.files) {
    lines.push(`${file.label}: ${file.exists ? formatBytes(file.sizeBytes) : 'missing'}`);
  }
  lines.push(`runtime: ${report.runtime.exists ? `${formatBytes(report.runtime.sizeBytes)} (${report.runtime.files} files)` : 'missing'}`);
  lines.push(`coordination total: ${formatBytes(report.coordinationTotalBytes)}`);
  lines.push('');
  lines.push('Recommended action:');
  lines.push(report.recommendations.map((entry) => `- ${entry}`).join('\n'));
  return lines.join('\n');
}

function summarizeTasks(board) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const blockedTasks = tasks.filter((task) => task.status === 'blocked');
  return {
    total: tasks.length,
    active: activeTasks,
    blocked: blockedTasks,
    counts: tasks.reduce((counts, task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function releaseReadiness(tasks) {
  if (tasks.active.length) {
    return {
      ready: false,
      reason: `${tasks.active.length} active or handoff task(s) remain.`,
    };
  }
  return {
    ready: true,
    reason: 'No active, blocked, waiting, review, or handoff tasks remain.',
  };
}

export function buildStatusBadgeMarkdown(context) {
  const generatedAt = new Date().toISOString();
  const health = buildWorkspaceHealth(context);
  const tasks = summarizeTasks(context.board);
  const readiness = releaseReadiness(tasks);
  const lines = [
    '# AI Agents Status',
    '',
    `Last updated: ${generatedAt}`,
    '',
    `Health score: ${health.score}/${health.maxScore} (${health.level})`,
    `Release readiness: ${readiness.ready ? 'ready' : 'not ready'} - ${readiness.reason}`,
    '',
    'Task counts:',
  ];

  for (const [status, count] of Object.entries(tasks.counts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${status}: ${count}`);
  }
  if (!Object.keys(tasks.counts).length) lines.push('- none: 0');

  lines.push('');
  lines.push('Active tasks:');
  lines.push(tasks.active.length ? tasks.active.map((task) => `- ${task.id}: ${task.status}${task.ownerId ? ` by ${task.ownerId}` : ''}`).join('\n') : '- none');
  lines.push('');
  lines.push('Blocked tasks:');
  lines.push(tasks.blocked.length ? tasks.blocked.map((task) => `- ${task.id}: ${task.ownerId ?? 'unowned'} - ${task.blocker ?? task.summary ?? 'No blocker recorded'}`).join('\n') : '- none');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

export function runStateSize(argv, context) {
  const report = buildStateSizeReport(context);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderStateSize(report));
  return 0;
}

export function runStatusBadge(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const outPath = path.resolve(context.root, 'docs', 'ai-agents-status.md');
  const content = buildStatusBadgeMarkdown(context);
  let workspaceSnapshotPath = null;

  if (apply) {
    workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, 'status-badge');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }

  const result = {
    ok: true,
    applied: apply,
    path: normalizePath(path.relative(context.root, outPath)),
    workspaceSnapshotPath,
  };

  if (json) {
    console.log(JSON.stringify({ ...result, content }, null, 2));
  } else {
    console.log(apply ? `Status file written: ${result.path}` : `Status file dry run: ${result.path}`);
    console.log('');
    console.log(content.trimEnd());
  }
  return 0;
}
