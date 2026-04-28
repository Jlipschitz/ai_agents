import { nowIso } from './file-utils.mjs';
import { evaluateCapacityPolicy, predictClaimConflicts } from './claim-policy.mjs';

export function createTaskClaimCommands(context) {
  const {
    activeTaskStatuses,
    appendJournalLine,
    collectMergeRiskWarnings,
    claimPolicies,
    coordinationLabel,
    ensureBaseFiles,
    ensureTask,
    ensureVisualVerificationForTask,
    getBoard,
    getCommandAgent,
    getGitChangedPaths,
    getTask,
    getVisualVerificationChecksForTask,
    hasVisualImpact,
    inferRelevantDocs,
    inferDomainsFromPaths,
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
      const domains = inferDomainsFromPaths(claimedPaths);

      if (agent.taskId && agent.taskId !== taskId) {
        throw new Error(`${agentId} is already assigned to "${agent.taskId}". Release or hand off that task first.`);
      }

      const capacity = evaluateCapacityPolicy({
        board,
        agentId,
        taskId,
        domains,
        policy: claimPolicies.capacity,
        activeTaskStatuses,
      });

      if (capacity.errors.length) {
        throw new Error(`Claim rejected by capacity policy: ${capacity.errors.join(' ')}`);
      }

      const conflicts = collectPathConflicts(board, agentId, taskId, claimedPaths);

      if (conflicts.length) {
        const summary = conflicts.map((conflict) => `${conflict.ownerId}/${conflict.taskId} (${conflict.path})`).join(', ');
        throw new Error(`Claim rejected because the requested paths overlap existing work: ${summary}`);
      }

      const predictedConflicts = predictClaimConflicts({
        board,
        agentId,
        taskId,
        claimedPaths,
        gitChangedPaths: getGitChangedPaths(),
        policy: claimPolicies.conflicts,
        activeTaskStatuses,
        pathsOverlap,
      });

      if (predictedConflicts.errors.length && !options.force) {
        throw new Error(`Claim rejected by conflict prediction: ${predictedConflicts.errors.join(' ')} Re-run with --force only if this overlap is intentional.`);
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
      for (const warning of [...capacity.warnings, ...predictedConflicts.warnings]) {
        console.warn(`warning: ${warning}`);
      }
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

  return {
    claimCommand,
    initCommand,
    progressCommand,
    reviewDocsCommand,
  };
}
