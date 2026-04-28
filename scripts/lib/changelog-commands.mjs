import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { readJsonSafe } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const TERMINAL_STATUSES = new Set(['done', 'released']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseSinceMs(value) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function taskDate(task) {
  return task.releasedAt ?? task.completedAt ?? task.updatedAt ?? task.createdAt ?? null;
}

function taskDateMs(task) {
  const ms = Date.parse(taskDate(task) ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTask(task, source) {
  return {
    ...task,
    source,
    claimedPaths: array(task?.claimedPaths),
    verification: array(task?.verification),
    verificationLog: array(task?.verificationLog),
    relevantDocs: array(task?.relevantDocs),
    notes: array(task?.notes),
  };
}

function readArchivedTasks(paths) {
  const archiveRoot = path.join(paths.coordinationRoot, 'archive');
  if (!fs.existsSync(archiveRoot)) {
    return [];
  }

  return fs
    .readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^tasks-\d{4}-\d{2}\.json$/.test(entry.name))
    .flatMap((entry) => {
      const archivePath = path.join(archiveRoot, entry.name);
      const payload = readJsonSafe(archivePath, { tasks: [] });
      return array(payload.tasks).map((task) => normalizeTask(task, normalizePath(archivePath) || archivePath));
    });
}

function collectTerminalTasks(paths) {
  const board = readJsonSafe(paths.boardPath, { tasks: [] });
  const boardTasks = array(board.tasks)
    .filter((task) => TERMINAL_STATUSES.has(task?.status))
    .map((task) => normalizeTask(task, 'board'));
  const archivedTasks = readArchivedTasks(paths);
  const byId = new Map();

  for (const task of [...archivedTasks, ...boardTasks]) {
    if (task?.id) {
      byId.set(task.id, task);
    }
  }

  return [...byId.values()];
}

function latestVerificationRows(task) {
  const byCheck = new Map();
  for (const entry of task.verificationLog) {
    if (entry?.check) {
      byCheck.set(entry.check, entry);
    }
  }
  return [...byCheck.entries()].map(([check, entry]) => ({
    check,
    outcome: entry?.outcome ?? entry?.status ?? 'unknown',
    at: entry?.at ?? null,
    details: entry?.details ?? '',
    artifactCount: array(entry?.artifacts).length,
  }));
}

function monthKey(task) {
  const date = taskDate(task);
  return date ? date.slice(0, 7) : 'unknown';
}

function taskEntry(task) {
  return {
    id: task.id,
    title: task.title ?? '',
    status: task.status ?? 'unknown',
    summary: task.summary ?? task.rationale ?? '',
    date: taskDate(task),
    source: task.source,
    claimedPaths: task.claimedPaths,
    verification: latestVerificationRows(task),
    relevantDocs: task.relevantDocs,
  };
}

export function buildChangelog(paths, argv = []) {
  const since = getFlagValue(argv, '--since', '');
  const sinceMs = parseSinceMs(since);
  const tasks = collectTerminalTasks(paths)
    .filter((task) => {
      if (!sinceMs) {
        return true;
      }
      const ms = taskDateMs(task);
      return ms && ms >= sinceMs;
    })
    .sort((left, right) => taskDateMs(right) - taskDateMs(left) || String(left.id).localeCompare(String(right.id)));
  const entries = tasks.map(taskEntry);
  const groups = entries.reduce((map, entry) => {
    const key = entry.date ? entry.date.slice(0, 7) : 'unknown';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(entry);
    return map;
  }, new Map());

  return {
    ok: true,
    since: since || null,
    entryCount: entries.length,
    entries,
    groups: [...groups.entries()].map(([month, items]) => ({ month, items })),
  };
}

function renderVerification(rows) {
  if (!rows.length) {
    return 'verification: none recorded';
  }
  return `verification: ${rows
    .map((entry) => `${entry.check} ${entry.outcome}${entry.artifactCount ? ` (${entry.artifactCount} artifact(s))` : ''}`)
    .join(', ')}`;
}

export function renderChangelog(changelog) {
  const lines = ['# Changelog', ''];
  if (changelog.since) {
    lines.push(`Since: ${changelog.since}`);
    lines.push('');
  }

  if (!changelog.groups.length) {
    lines.push('- No completed or released tasks found.');
    return lines.join('\n');
  }

  for (const group of changelog.groups) {
    lines.push(`## ${group.month}`);
    lines.push('');
    for (const entry of group.items) {
      const title = entry.title ? ` - ${entry.title}` : '';
      const date = entry.date ? ` (${entry.date})` : '';
      lines.push(`- ${entry.id}${title}: ${entry.summary || entry.status}${date}`);
      if (entry.claimedPaths.length) {
        lines.push(`  - paths: ${entry.claimedPaths.join(', ')}`);
      }
      lines.push(`  - ${renderVerification(entry.verification)}`);
      if (entry.relevantDocs.length) {
        lines.push(`  - docs: ${entry.relevantDocs.join(', ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function runChangelogCommand(argv, paths) {
  const json = hasFlag(argv, '--json');
  const changelog = buildChangelog(paths, argv);
  if (json) {
    console.log(JSON.stringify(changelog, null, 2));
  } else {
    console.log(renderChangelog(changelog));
  }
  return 0;
}
