import { nowIso } from './file-utils.mjs';

export function createTaskLifecycleCommands(context) {
  const {
    activeTaskStatuses,
    appendJournalLine,
    assertAgentSessionAvailable,
    buildDependencyInsight,
    buildWaitingInsights,
    collectMergeRiskWarnings,
    coordinationLabel,
    ensureBaseFiles,
    ensureTask,
    ensureVisualVerificationForTask,
    getAgent,
    getBoard,
    getCommandAgent,
    getCurrentCommandName,
    getReadOnlyBoard,
    getTask,
    getVisualVerificationChecksForTask,
    hasVisualImpact,
    inferRelevantDocs,
    isTaskStale,
    maybeQueueAssistMessages,
    note,
    parsePathsOption,
    pathsOverlap,
    plannedTaskStatus,
    saveBoard,
    slugify,
    terminalTaskStatuses,
    withMutationLock,
  } = context;

  function collectPathConflicts(board, agentId, taskId, claimedPaths) {
    const conflicts = [];

    for (const task of board.tasks) {
      if (!task.ownerId || task.ownerId === agentId || task.id === taskId || !activeTaskStatuses.has(task.status)) {
        continue;
      }

      for (const claimedPath of claimedPaths) {
        const overlap = task.claimedPaths.find((taskPath) => pathsOverlap(taskPath, claimedPath));

        if (overlap) {
          conflicts.push({
            taskId: task.id,
            ownerId: task.ownerId,
            path: overlap,
          });
        }
      }
    }

    return conflicts;
  }

  async function initCommand() {
    await withMutationLock(async () => {
      ensureBaseFiles();
      const board = getBoard();
      await saveBoard(board);
    });
    console.log(`Initialized coordination workspace at ${coordinationLabel}.`);
  }

  async function claimCommand(positionals, options) {
    const [agentId, taskId] = positionals;
    const claimedPaths = parsePathsOption(options.paths);
    const issueKey = typeof options.issue === 'string' ? slugify(options.issue) : null;

    if (!agentId || !taskId) {
      throw new Error('Usage: claim <agent> <task-id> --paths <path[,path...]> [--summary <text>] [--force]');
    }

    if (!claimedPaths.length) {
      throw new Error('Claims require at least one path via --paths.');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const agent = getCommandAgent(board, agentId);

      if (agent.taskId && agent.taskId !== taskId) {
        throw new Error(`${agentId} is already assigned to "${agent.taskId}". Release or hand off that task first.`);
      }

      const conflicts = collectPathConflicts(board, agentId, taskId, claimedPaths);

      if (conflicts.length) {
        const summary = conflicts.map((conflict) => `${conflict.ownerId}/${conflict.taskId} (${conflict.path})`).join(', ');
        throw new Error(`Claim rejected because the requested paths overlap existing work: ${summary}`);
      }

      const candidateTask = getTask(board, taskId) ?? {
        id: taskId,
        ownerId: agentId,
        status: 'active',
        claimedPaths,
        issueKey,
        dependencies: [],
        verification: [],
        verificationLog: [],
        notes: [],
        rationale: '',
        effort: 'unknown',
        waitingOn: [],
        summary: typeof options.summary === 'string' ? options.summary : '',
      };
      candidateTask.claimedPaths = claimedPaths;
      candidateTask.issueKey = issueKey ?? candidateTask.issueKey ?? null;
      candidateTask.relevantDocs = inferRelevantDocs(claimedPaths, candidateTask.summary, candidateTask.verification);
      const riskWarnings = collectMergeRiskWarnings(
        candidateTask,
        board.tasks.filter((task) => task.id !== taskId && task.ownerId && activeTaskStatuses.has(task.status))
      );

      if (riskWarnings.length && !options.force) {
        throw new Error(`Claim rejected because of shared-risk overlap: ${riskWarnings.join(' ')}`);
      }

      let task = getTask(board, taskId);
      const startedAt = nowIso();

      if (task?.status === plannedTaskStatus) {
        const unmetDependencies = task.dependencies.filter((dependencyId) => {
          const dependencyTask = getTask(board, dependencyId);
          return dependencyTask && !terminalTaskStatuses.has(dependencyTask.status);
        });

        if (unmetDependencies.length && !options.force) {
          throw new Error(
            `Claim rejected because planned dependencies are still open: ${unmetDependencies.join(
              ', '
            )}. Re-run with --force if you intentionally want parallel work.`
          );
        }
      }

      if (!task) {
        task = {
          id: taskId,
          ownerId: agentId,
          lastOwnerId: agentId,
          status: 'active',
          summary: options.summary && typeof options.summary === 'string' ? options.summary : '',
          claimedPaths,
          suggestedOwnerId: null,
          dependencies: [],
          verification: [],
          verificationLog: [],
          rationale: '',
          effort: 'unknown',
          issueKey,
          waitingOn: [],
          relevantDocs: inferRelevantDocs(claimedPaths, options.summary && typeof options.summary === 'string' ? options.summary : '', []),
          docsReviewedAt: null,
          docsReviewedBy: null,
          createdAt: startedAt,
          updatedAt: startedAt,
          lastHandoff: null,
          notes: [],
        };
        board.tasks.push(task);
      } else {
        task.ownerId = agentId;
        task.lastOwnerId = agentId;
        task.status = 'active';
        task.claimedPaths = claimedPaths;
        task.issueKey = issueKey ?? task.issueKey ?? null;
        task.waitingOn = [];
        if (typeof options.summary === 'string') {
          task.summary = options.summary;
        }
        task.relevantDocs = inferRelevantDocs(task.claimedPaths, task.summary, task.verification);
        task.updatedAt = startedAt;
      }

      task.verification = ensureVisualVerificationForTask(board, task);
      task.relevantDocs = inferRelevantDocs(task.claimedPaths, task.summary, task.verification);

      agent.status = 'active';
      agent.taskId = taskId;
      agent.updatedAt = startedAt;

      note(task, agentId, 'claim', `Claimed ${claimedPaths.join(', ')}.${task.summary ? ` Summary: ${task.summary}` : ''}`);
      appendJournalLine(`- ${startedAt} | ${agentId} claimed \`${taskId}\` on ${claimedPaths.join(', ')}.`);
      await saveBoard(board);
      console.log(`Claimed ${taskId} for ${agentId}.`);
      if (task.relevantDocs.length) {
        console.log(`Review docs before coding: ${task.relevantDocs.join(', ')}`);
      }
      if (hasVisualImpact(task.claimedPaths)) {
        console.log(
          `Visual suite required: ${getVisualVerificationChecksForTask(board, task).join(', ') || 'covered by dependent visual verification task'}.`
        );
      }
    });
  }

  async function reviewDocsCommand(positionals, options) {
    const [agentId, taskId] = positionals;
    const docsOverride = parsePathsOption(options.docs);
    const noteText = typeof options.note === 'string' ? options.note.trim() : '';

    if (!agentId || !taskId) {
      throw new Error('Usage: review-docs <agent> <task-id> [--docs <path[,path...]>] [--note <text>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot review docs for "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const relevantDocs = docsOverride.length ? docsOverride : inferRelevantDocs(task.claimedPaths, task.summary, task.verification);
      const timestamp = nowIso();

      task.relevantDocs = relevantDocs;
      task.docsReviewedAt = timestamp;
      task.docsReviewedBy = agentId;
      task.updatedAt = timestamp;
      note(task, agentId, 'docs-review', `Reviewed docs: ${relevantDocs.join(', ') || 'none recorded'}${noteText ? `. ${noteText}` : ''}`);

      agent.updatedAt = timestamp;
      appendJournalLine(`- ${timestamp} | ${agentId} reviewed docs for \`${taskId}\`: ${relevantDocs.join(', ') || 'none recorded'}.`);
      await saveBoard(board);
      console.log(`Docs review recorded for ${taskId}.`);
    });
  }

  async function progressCommand(positionals) {
    const [agentId, taskId, ...noteParts] = positionals;
    const body = noteParts.join(' ').trim();

    if (!agentId || !taskId || !body) {
      throw new Error('Usage: progress <agent> <task-id> <note>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot log progress on "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      task.updatedAt = nowIso();
      note(task, agentId, 'progress', body);
      agent.updatedAt = task.updatedAt;
      appendJournalLine(`- ${task.updatedAt} | ${agentId} progress on \`${taskId}\`: ${body}`);
      await saveBoard(board);
      console.log(`Progress recorded on ${taskId}.`);
    });
  }

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
    claimCommand,
    handoffCommand,
    initCommand,
    pickCommand,
    progressCommand,
    resumeCommand,
    reviewDocsCommand,
    setTaskStatusCommand,
    waitCommand,
  };
}
