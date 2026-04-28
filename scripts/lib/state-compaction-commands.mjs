import fs from 'node:fs';
import path from 'node:path';

import { getNumberFlag, hasFlag } from './args-utils.mjs';
import { fileTimestamp, readJsonSafe, writeJson } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const DEFAULT_KEEP_JOURNAL_LINES = 200;
const DEFAULT_KEEP_MESSAGE_LINES = 500;

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function trimTrailingEmpty(lines) {
  const next = [...lines];
  while (next.length && next[next.length - 1] === '') next.pop();
  return next;
}

function splitCompaction(lines, keepCount) {
  const content = trimTrailingEmpty(lines);
  const keep = keepCount > 0 ? content.slice(-keepCount) : [];
  const archive = keepCount > 0 ? content.slice(0, Math.max(0, content.length - keepCount)) : content;
  return { keep, archive };
}

function writeLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.length ? `${lines.join('\n')}\n` : '');
}

function parseArgs(argv) {
  return {
    json: hasFlag(argv, '--json'),
    apply: hasFlag(argv, '--apply'),
    keepJournalLines: getNumberFlag(argv, '--keep-journal-lines', DEFAULT_KEEP_JOURNAL_LINES),
    keepMessageLines: getNumberFlag(argv, '--keep-message-lines', DEFAULT_KEEP_MESSAGE_LINES),
  };
}

function buildCompactionPlan(paths, args) {
  const journal = splitCompaction(readLines(paths.journalPath), args.keepJournalLines);
  const messages = splitCompaction(readLines(paths.messagesPath), args.keepMessageLines);
  const archiveRoot = path.join(paths.coordinationRoot, 'archive');
  const archivePath = path.join(archiveRoot, `state-compaction-${fileTimestamp()}.json`);
  return {
    ok: true,
    applied: false,
    archivePath,
    workspaceSnapshotPath: null,
    keep: {
      journalLines: journal.keep.length,
      messageLines: messages.keep.length,
    },
    compact: {
      journalLines: journal.archive.length,
      messageLines: messages.archive.length,
    },
    files: {
      journalPath: paths.journalPath,
      messagesPath: paths.messagesPath,
    },
    data: {
      compactedAt: new Date().toISOString(),
      boardUpdatedAt: readJsonSafe(paths.boardPath, {})?.updatedAt ?? null,
      journalLines: journal.archive,
      messageLines: messages.archive,
    },
    next: {
      journalLines: journal.keep,
      messageLines: messages.keep,
    },
  };
}

function printablePath(filePath) {
  return normalizePath(filePath) || filePath;
}

function renderCompactionResult(result) {
  return [
    result.applied ? 'State compaction applied.' : 'State compaction dry run.',
    `Archive: ${printablePath(result.archivePath)}`,
    `Journal: compact ${result.compact.journalLines}, keep ${result.keep.journalLines}`,
    `Messages: compact ${result.compact.messageLines}, keep ${result.keep.messageLines}`,
    result.workspaceSnapshotPath ? `Workspace snapshot: ${printablePath(result.workspaceSnapshotPath)}` : '',
  ].filter(Boolean).join('\n');
}

export function runCompactState(argv, paths) {
  const args = parseArgs(argv);
  const plan = buildCompactionPlan(paths, args);
  if (args.apply && (plan.compact.journalLines || plan.compact.messageLines)) {
    const archiveRoot = path.dirname(plan.archivePath);
    withStateTransactionSync([paths.journalPath, paths.messagesPath, archiveRoot, paths.snapshotsRoot], () => {
      plan.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(paths, 'compact-state');
      fs.mkdirSync(archiveRoot, { recursive: true });
      writeJson(plan.archivePath, plan.data);
      writeLines(paths.journalPath, plan.next.journalLines);
      writeLines(paths.messagesPath, plan.next.messageLines);
    });
    plan.applied = true;
  }
  const { data, next, ...result } = plan;
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(renderCompactionResult(result));
  return 0;
}
