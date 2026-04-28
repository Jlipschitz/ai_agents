import { nowIso } from './file-utils.mjs';
import { formatTaskDueAt, taskUrgencyScore } from './task-metadata.mjs';

export function createTaskFlowCommands(context) {
  const {
    appendJournalLine,
    assertAgentSessionAvailable,
    buildDependencyInsight,
    buildWaitingInsights,
    ensureTask,
    getAgent,
    getBoard,
    getCommandAgent,
    getCurrentCommandName,
    getReadOnlyBoard,
    getTask,
    isTaskStale,
    maybeQueueAssistMessages,
    note,
    parsePathsOption,
    plannedTaskStatus,
    saveBoard,
    terminalTaskStatuses,
    withMutationLock,
  } = context;

  async function waitCommand(positionals, options) {
    const [agentId, taskId] = positionals;
    const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
    const waitingOn = parsePathsOption(options.on);

    if (!agentId || !taskId || !reason || !waitingOn.length) {
      throw new Error('Usage: wait <agent> <task-id> --on <task-id[,task-id...]> --reason <text>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot wait on "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      for (const dependencyId of waitingOn) {
        if (!getTask(board, dependencyId)) {
          throw new Error(`Cannot wait on missing task "${dependencyId}".`);
        }
      }

      const timestamp = nowIso();
      task.status = 'waiting';
      task.waitingOn = waitingOn;
      task.updatedAt = timestamp;
      note(task, agentId, 'waiting', `Waiting on ${waitingOn.join(', ')}. ${reason}`);

      agent.status = 'waiting';
      agent.taskId = taskId;
      agent.updatedAt = timestamp;

      const waitingInsights = buildWaitingInsights(board, task, timestamp);
      const sentAssistMessages = maybeQueueAssistMessages(board, task, timestamp);

      appendJournalLine(`- ${timestamp} | ${agentId} set \`${taskId}\` to waiting on ${waitingOn.join(', ')}: ${reason}`);
      await saveBoard(board);
      console.log(`Marked ${taskId} as waiting.`);
      if (waitingInsights.length) {
        console.log(
          waitingInsights
            .map((insight) => {
              const ownerLabel = insight.ownerId ?? 'unowned';
              return `- waiting on ${insight.dependencyTaskId}: ${ownerLabel} | ${insight.status} | updated ${insight.updatedAgo} | ${insight.reason}`;
            })
            .join('\n')
        );
      }
      if (sentAssistMessages.length) {
        console.log(
          sentAssistMessages
            .map((message) => `- assist ping sent to ${message.to} on ${message.taskId}: ${message.body}`)
            .join('\n')
        );
      }
    });
  }

  async function resumeCommand(positionals) {
    const [agentId, taskId, ...noteParts] = positionals;
    const body = noteParts.join(' ').trim();

    if (!agentId || !taskId || !body) {
      throw new Error('Usage: resume <agent> <task-id> <note>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot resume "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const unresolved = task.waitingOn.filter((dependencyId) => {
        const dependencyTask = getTask(board, dependencyId);
        return dependencyTask && !terminalTaskStatuses.has(dependencyTask.status);
      });

      if (unresolved.length) {
        const details = unresolved
          .map((dependencyId) => {
            const insight = buildDependencyInsight(board, dependencyId);
            const ownerLabel = insight.ownerId ?? 'unowned';
            return `${dependencyId} (${ownerLabel}, ${insight.status}, updated ${insight.updatedAgo}: ${insight.reason})`;
          })
          .join('; ');
        throw new Error(`Cannot resume because these waited-on tasks are still open: ${details}.`);
      }

      const timestamp = nowIso();
      task.status = 'active';
      task.waitingOn = [];
      task.updatedAt = timestamp;
      note(task, agentId, 'resume', body);

      agent.status = 'active';
      agent.taskId = taskId;
      agent.updatedAt = timestamp;

      appendJournalLine(`- ${timestamp} | ${agentId} resumed \`${taskId}\`: ${body}`);
      await saveBoard(board);
      console.log(`Resumed ${taskId}.`);
    });
  }

  function areDependenciesSatisfied(board, task) {
    return task.dependencies.every((dependencyId) => {
      const dependencyTask = getTask(board, dependencyId);
      return dependencyTask && terminalTaskStatuses.has(dependencyTask.status);
    });
  }

  function buildHandoffBody(rawBody, options) {
    const directBody = rawBody.trim();

    if (directBody) {
      return directBody;
    }

    const summary = typeof options.summary === 'string' ? options.summary.trim() : '';
    const next = typeof options.next === 'string' ? options.next.trim() : '';
    const blocker = typeof options.blocker === 'string' ? options.blocker.trim() : '';

    if (!summary || !next) {
      throw new Error('Structured handoff requires both --summary and --next when no free-form note is provided.');
    }

    return `Summary: ${summary}\nNext: ${next}${blocker ? `\nBlocker: ${blocker}` : ''}`;
  }

  function scorePick(board, task, agentId) {
    let score = 0;

    if (task.suggestedOwnerId === agentId) {
      score += 10;
    }
    if (task.status === 'handoff') {
      score += 8;
    }
    if (task.status === 'review') {
      score += 6;
    }
    if (task.status === plannedTaskStatus) {
      score += 4;
    }
    if (areDependenciesSatisfied(board, task)) {
      score += 5;
    }
    if (isTaskStale(task)) {
      score += 3;
    }
    score += taskUrgencyScore(task);

    return score;
  }

  function pickCommand(positionals) {
    const [agentId] = positionals;

    if (!agentId) {
      throw new Error('Usage: pick <agent>');
    }

    const board = getReadOnlyBoard();
    assertAgentSessionAvailable(agentId, getCurrentCommandName(), { cleanupStale: false });
    const agent = getAgent(board, agentId);

    if (agent.taskId) {
      console.log(`${agentId} is already assigned to ${agent.taskId}.`);
      return;
    }

    const candidates = board.tasks.filter((task) => {
      if (task.ownerId) {
        return false;
      }

      if (task.status === 'handoff' || task.status === 'review') {
        return true;
      }

      if (task.status === plannedTaskStatus) {
        return areDependenciesSatisfied(board, task);
      }

      return false;
    });

    if (!candidates.length) {
      console.log(`No ready task found for ${agentId}.`);
      return;
    }

    const [bestTask] = [...candidates].sort((left, right) => {
      const scoreDelta = scorePick(board, right, agentId) - scorePick(board, left, agentId);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.id.localeCompare(right.id);
    });

    console.log(`Recommended for ${agentId}: ${bestTask.id}`);
    console.log(`Status: ${bestTask.status}`);
    console.log(`Priority: ${bestTask.priority || 'normal'}`);
    console.log(`Due: ${formatTaskDueAt(bestTask.dueAt)}`);
    console.log(`Severity: ${bestTask.severity || 'none'}`);
    console.log(`Summary: ${bestTask.summary || 'No summary'}`);
    console.log(`Paths: ${bestTask.claimedPaths.join(', ') || 'none'}`);
    console.log(`Dependencies: ${bestTask.dependencies.join(', ') || 'none'}`);
    console.log(`Verification: ${bestTask.verification.join(', ') || 'none'}`);
    console.log(`Docs: ${bestTask.relevantDocs.join(', ') || 'none suggested'}`);
    console.log(`Docs reviewed: ${bestTask.docsReviewedAt ? `yes (${bestTask.docsReviewedAt})` : 'no'}`);
  }

  async function setTaskStatusCommand(positionals, nextStatus) {
    const [agentId, taskId, ...noteParts] = positionals;
    const body = noteParts.join(' ').trim();

    if (!agentId || !taskId || !body) {
      throw new Error(`Usage: ${nextStatus} <agent> <task-id> <note>`);
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot mark "${taskId}" as ${nextStatus} because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const timestamp = nowIso();
      task.status = nextStatus;
      task.updatedAt = timestamp;
      note(task, agentId, nextStatus, body);

      agent.status = nextStatus;
      agent.taskId = taskId;
      agent.updatedAt = timestamp;

      appendJournalLine(`- ${timestamp} | ${agentId} marked \`${taskId}\` as ${nextStatus}: ${body}`);
      await saveBoard(board);
      console.log(`Marked ${taskId} as ${nextStatus}.`);
    });
  }

  async function handoffCommand(positionals, options) {
    const [agentId, taskId, ...noteParts] = positionals;
    const body = buildHandoffBody(noteParts.join(' '), options);

    if (!agentId || !taskId) {
      throw new Error('Usage: handoff <agent> <task-id> <note> [--to <agent>]');
    }

    if (typeof options.to === 'string') {
      getAgent(getBoard(), options.to);
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot hand off "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const timestamp = nowIso();
      task.ownerId = null;
      task.status = 'handoff';
      task.updatedAt = timestamp;
      task.lastOwnerId = agentId;
      task.lastHandoff = {
        at: timestamp,
        from: agentId,
        to: typeof options.to === 'string' ? options.to : null,
        body,
      };
      note(task, agentId, 'handoff', body, { to: task.lastHandoff.to });

      agent.status = 'idle';
      agent.taskId = null;
      agent.updatedAt = timestamp;

      appendJournalLine(`- ${timestamp} | ${agentId} handed off \`${taskId}\`${task.lastHandoff.to ? ` to ${task.lastHandoff.to}` : ''}: ${body}`);
      await saveBoard(board);
      console.log(`Handoff recorded for ${taskId}.`);
    });
  }

  return {
    handoffCommand,
    pickCommand,
    resumeCommand,
    setTaskStatusCommand,
    waitCommand,
  };
}
