import fs from 'node:fs';
import path from 'node:path';

import { fileExists, nowIso } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

function parseArtifactPaths(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferArtifactKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image';
  if (['.html', '.htm'].includes(extension)) return 'report';
  if (['.zip', '.trace'].includes(extension)) return 'trace';
  if (['.log', '.txt'].includes(extension)) return 'log';
  if (['.json', '.ndjson'].includes(extension)) return 'data';
  return 'file';
}

export function createTaskCompletionCommands(context) {
  const {
    root,
    artifactRoots,
    appAgentNotesDoc,
    appendJournalLine,
    cliRunLabel,
    ensureTask,
    getBoard,
    getCommandAgent,
    getMissingVisualPassingChecks,
    note,
    saveBoard,
    withMutationLock,
  } = context;

  function isAllowedArtifactPath(normalizedPath) {
    return artifactRoots.some((artifactRoot) => normalizedPath === artifactRoot || normalizedPath.startsWith(`${artifactRoot}/`));
  }

  function buildVerificationArtifactReferences(options) {
    const artifactPaths = parseArtifactPaths(options.artifact);
    const allowUntracked = options['allow-untracked-artifact'] === true;

    return artifactPaths.map((artifactPath) => {
      const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(root, artifactPath);
      const normalizedPath = normalizePath(absolutePath, root);

      if (!fileExists(absolutePath)) {
        throw new Error(`Verification artifact does not exist: ${artifactPath}`);
      }

      if (!allowUntracked && !isAllowedArtifactPath(normalizedPath)) {
        throw new Error(`Verification artifact must be under configured artifact roots (${artifactRoots.join(', ')}): ${artifactPath}`);
      }

      const stats = fs.statSync(absolutePath);
      return {
        path: normalizedPath,
        kind: inferArtifactKind(artifactPath),
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
      };
    });
  }

  async function verifyCommand(positionals, options) {
    const [agentId, taskId, check, outcome] = positionals;
    const normalizedOutcome = (outcome ?? '').toLowerCase();
    const details = typeof options.details === 'string' ? options.details.trim() : positionals.slice(4).join(' ').trim();

    if (!agentId || !taskId || !check || !normalizedOutcome) {
      throw new Error('Usage: verify <agent> <task-id> <check> <pass|fail> [--details <text>]');
    }

    if (!['pass', 'fail'].includes(normalizedOutcome)) {
      throw new Error('Verification outcome must be either "pass" or "fail".');
    }

    const artifacts = buildVerificationArtifactReferences(options);

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      getCommandAgent(board, agentId);

      task.updatedAt = nowIso();
      if (!task.verification.includes(check)) {
        task.verification.push(check);
      }
      const entry = {
        at: task.updatedAt,
        agent: agentId,
        check,
        outcome: normalizedOutcome,
        details,
      };
      if (artifacts.length) {
        entry.artifacts = artifacts;
      }
      task.verificationLog.push(entry);

      const artifactSuffix = artifacts.length ? ` artifacts: ${artifacts.map((artifact) => artifact.path).join(', ')}` : '';
      note(task, agentId, 'verify', `${check}: ${normalizedOutcome}${details ? ` (${details})` : ''}${artifactSuffix}`);
      appendJournalLine(`- ${task.updatedAt} | ${agentId} verified \`${taskId}\` with ${check}: ${normalizedOutcome}${details ? ` | ${details}` : ''}${artifactSuffix ? ` | ${artifactSuffix}` : ''}`);
      await saveBoard(board);
      console.log(`Recorded verification for ${taskId}.`);
    });
  }

  async function releaseCommand(positionals, options) {
    const [agentId, taskId] = positionals;

    if (!agentId || !taskId) {
      throw new Error('Usage: release <agent> <task-id> [--note <text>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot release "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const timestamp = nowIso();
      task.ownerId = null;
      task.status = 'released';
      task.updatedAt = timestamp;
      task.lastOwnerId = agentId;

      if (typeof options.note === 'string' && options.note.trim()) {
        note(task, agentId, 'release', options.note.trim());
      }

      agent.status = 'idle';
      agent.taskId = null;
      agent.updatedAt = timestamp;

      appendJournalLine(`- ${timestamp} | ${agentId} released \`${taskId}\`${options.note ? `: ${options.note}` : ''}`);
      await saveBoard(board);
      console.log(`Released ${taskId}.`);
    });
  }

  async function doneCommand(positionals) {
    const [agentId, taskId, ...noteParts] = positionals;
    const body = noteParts.join(' ').trim();

    if (!agentId || !taskId || !body) {
      throw new Error('Usage: done <agent> <task-id> <note>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot mark "${taskId}" done because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const missingVisualChecks = getMissingVisualPassingChecks(board, task);
      if (missingVisualChecks.length) {
        throw new Error(
          `Cannot mark "${taskId}" done because UI/visual changes still need passing visual verification: ${missingVisualChecks.join(
            ', '
          )}. Update routes/snapshots when intentional, then record the visual pass.`
        );
      }

      const timestamp = nowIso();
      task.ownerId = null;
      task.status = 'done';
      task.updatedAt = timestamp;
      task.lastOwnerId = agentId;
      note(task, agentId, 'done', body);

      agent.status = 'idle';
      agent.taskId = null;
      agent.updatedAt = timestamp;

      appendJournalLine(`- ${timestamp} | ${agentId} completed \`${taskId}\`: ${body}`);
      await saveBoard(board);
      console.log(`Marked ${taskId} done.`);
      if (appAgentNotesDoc) {
        console.log(
          `If this exposed reusable errors, inconsistencies, or behavior changes, record them with: ${cliRunLabel(
            ` -- app-note ${agentId} change "..." --task ${taskId}`
          )}`
        );
      }
    });
  }

  return { doneCommand, releaseCommand, verifyCommand };
}
