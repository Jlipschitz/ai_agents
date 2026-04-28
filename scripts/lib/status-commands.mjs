import { nowIso } from './file-utils.mjs';

export function createStatusCommands(context) {
  const {
    appendJournalLine,
    appendMessage,
    assistMessageWindowHours,
    describeLock,
    ensureTaskDefaults,
    formatElapsed,
    getReadOnlyBoard,
    getStaleResources,
    getTask,
    getTaskStatusReason,
    getWatcherStatus,
    hasLiveAgentHeartbeat,
    isTaskStale,
    isWatcherAlive,
    note,
    plannedTaskStatus,
    readAgentHeartbeats,
    readMessages,
    renderHeartbeatLine,
  } = context;

  function buildDependencyInsight(board, dependencyTaskId, referenceIso = nowIso()) {
    const dependencyTask = getTask(board, dependencyTaskId);

    if (!dependencyTask) {
      return {
        dependencyTaskId,
        task: null,
        ownerId: null,
        status: 'missing',
        updatedAgo: 'unknown',
        reason: 'Dependency task is missing from the board.',
        needsAssist: true,
        assistAction: 'Recreate or re-plan the missing dependency task.',
        assistType: 'missing',
      };
    }

    ensureTaskDefaults(dependencyTask);

    let assistType = null;
    let assistAction = null;
    if (dependencyTask.status === 'blocked') {
      assistType = 'blocked';
      assistAction = dependencyTask.ownerId
        ? `Ask ${dependencyTask.ownerId} what is blocked and offer an unblock slice.`
        : 'Assign an owner and unblock the dependency.';
    } else if (dependencyTask.status === 'waiting') {
      assistType = 'waiting';
      assistAction = dependencyTask.ownerId
        ? `Ask ${dependencyTask.ownerId} whether you can help finish ${dependencyTask.waitingOn.join(', ') || 'their upstream dependency'}.`
        : 'Assign an owner and resolve the upstream dependency.';
    } else if (dependencyTask.status === 'review') {
      assistType = 'review';
      assistAction = `Help verify ${dependencyTaskId} or pick up its follow-up work.`;
    } else if (dependencyTask.status === 'handoff') {
      assistType = 'handoff';
      assistAction = `Pick up ${dependencyTaskId} or explicitly reassign it.`;
    } else if (dependencyTask.status === 'active' && isTaskStale(dependencyTask, referenceIso)) {
      assistType = 'stale';
      assistAction = dependencyTask.ownerId
        ? `Check with ${dependencyTask.ownerId} and offer help on the stalled work.`
        : 'Assign an owner before the stale work drifts further.';
    }

    return {
      dependencyTaskId,
      task: dependencyTask,
      ownerId: dependencyTask.ownerId ?? null,
      status: dependencyTask.status,
      updatedAgo: formatElapsed(dependencyTask.updatedAt, referenceIso),
      reason: getTaskStatusReason(dependencyTask),
      needsAssist: Boolean(assistType),
      assistAction,
      assistType,
    };
  }

  function buildWaitingInsights(board, task, referenceIso = nowIso()) {
    ensureTaskDefaults(task);
    return task.waitingOn.map((dependencyTaskId) => buildDependencyInsight(board, dependencyTaskId, referenceIso));
  }

  function buildLockContentionSummary(lock, board, referenceIso = nowIso()) {
    const parts = [];
    const lockDetails = describeLock(lock);

    if (lockDetails) {
      parts.push(lockDetails);
    }

    if (board) {
      const waitingTask = board.tasks.find((task) => task.status === 'waiting');
      if (waitingTask) {
        const insights = buildWaitingInsights(board, waitingTask, referenceIso);
        const insight = insights.find((entry) => entry.needsAssist) ?? insights[0];
        if (insight) {
          const ownerLabel = insight.ownerId ?? 'unowned';
          parts.push(
            `${waitingTask.id} is waiting on ${insight.dependencyTaskId} (${insight.status}, ${ownerLabel}, updated ${insight.updatedAgo}). ${insight.reason}`
          );
        }
      } else {
        const blockedTask = board.tasks.find((task) => task.status === 'blocked');
        if (blockedTask) {
          parts.push(
            `${blockedTask.id} is blocked${blockedTask.ownerId ? ` by ${blockedTask.ownerId}` : ''}. ${getTaskStatusReason(blockedTask)}`
          );
        }
      }
    }

    return parts.join(' | ');
  }

  function buildAssistMessage(waitingTask, insight) {
    if (!waitingTask.ownerId || !insight.ownerId || waitingTask.ownerId === insight.ownerId) {
      return null;
    }

    if (insight.assistType === 'review') {
      return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. If review is the only thing left, I can help verify or take follow-up work.`;
    }

    if (insight.assistType === 'handoff') {
      return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. It looks unowned; if you want, I can pick up a slice so my dependency closes sooner.`;
    }

    return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. It looks ${insight.status}; what is stuck, and can I help unblock it?`;
  }

  function hasRecentAssistMessage(messages, waitingTask, insight, referenceIso = nowIso()) {
    if (!waitingTask.ownerId || !insight.ownerId) {
      return false;
    }

    return messages.some(
      (message) =>
        message.from === waitingTask.ownerId &&
        message.to === insight.ownerId &&
        message.taskId === insight.dependencyTaskId &&
        typeof message.body === 'string' &&
        message.body.includes(waitingTask.id) &&
        hoursBetween(message.at ?? referenceIso, referenceIso) <= assistMessageWindowHours
    );
  }

  function hoursBetween(earlierIso, laterIso) {
    const earlier = Date.parse(earlierIso);
    const later = Date.parse(laterIso);

    if (!Number.isFinite(earlier) || !Number.isFinite(later)) {
      return 0;
    }

    return Math.max(0, (later - earlier) / (1000 * 60 * 60));
  }

  function maybeQueueAssistMessages(board, waitingTask, referenceIso = nowIso()) {
    ensureTaskDefaults(waitingTask);
    const existingMessages = readMessages();
    const sentMessages = [];

    for (const insight of buildWaitingInsights(board, waitingTask, referenceIso)) {
      const body = buildAssistMessage(waitingTask, insight);
      if (!body) {
        continue;
      }

      if (hasRecentAssistMessage(existingMessages, waitingTask, insight, referenceIso)) {
        continue;
      }

      const message = {
        at: referenceIso,
        from: waitingTask.ownerId,
        to: insight.ownerId,
        taskId: insight.dependencyTaskId,
        body,
      };
      appendMessage(message);
      appendJournalLine(
        `- ${referenceIso} | assist ping ${waitingTask.ownerId} -> ${insight.ownerId} on \`${insight.dependencyTaskId}\`: ${body}`
      );
      note(waitingTask, waitingTask.ownerId, 'assist-request', `Asked ${insight.ownerId} how to unblock ${insight.dependencyTaskId}.`);
      existingMessages.push(message);
      sentMessages.push(message);
    }

    return sentMessages;
  }

  function renderWaitingDetailLines(board, waitingTasks, referenceIso = nowIso()) {
    const lines = [];

    for (const waitingTask of waitingTasks) {
      const insights = buildWaitingInsights(board, waitingTask, referenceIso);
      if (!insights.length) {
        lines.push(`- ${waitingTask.id}: waiting, but no dependency detail is recorded.`);
        continue;
      }

      for (const insight of insights) {
        const ownerLabel = insight.ownerId ?? 'unowned';
        lines.push(
          `- ${waitingTask.id} -> ${insight.dependencyTaskId}: ${ownerLabel} | ${insight.status} | updated ${insight.updatedAgo} | ${insight.reason}`
        );
      }
    }

    return lines;
  }

  function collectAssistOpportunityLines(board, referenceIso = nowIso()) {
    const lines = [];
    const seen = new Set();

    for (const task of board.tasks.filter((entry) => entry.status === 'waiting')) {
      for (const insight of buildWaitingInsights(board, task, referenceIso)) {
        if (!insight.needsAssist) {
          continue;
        }

        const key = `${task.id}:${insight.dependencyTaskId}:${insight.assistType ?? 'assist'}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        lines.push(`- ${task.id} -> ${insight.dependencyTaskId}: ${insight.assistAction}`);
      }
    }

    for (const task of board.tasks.filter((entry) => entry.status === 'blocked')) {
      const key = `blocked:${task.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      lines.push(
        `- ${task.id}: ${task.ownerId ?? 'unowned'} is blocked. ${getTaskStatusReason(task)} Suggested assist: ${
          task.ownerId ? `check with ${task.ownerId} and offer the missing slice.` : 'assign an owner and unblock it.'
        }`
      );
    }

    return lines;
  }

  function renderTaskLine(task, ownerLabel, liveHeartbeats = new Map(), referenceIso = nowIso()) {
    ensureTaskDefaults(task);
    const dependencyLabel = task.dependencies.length ? ` | depends on ${task.dependencies.join(', ')}` : '';
    const effortLabel = task.effort ? ` | effort ${task.effort}` : '';
    const unattendedStale = isTaskStale(task, referenceIso) && !hasLiveAgentHeartbeat(task.ownerId, liveHeartbeats);
    const staleLabel = unattendedStale ? ' | stale' : '';
    return `- ${task.id}: ${ownerLabel} -> ${task.claimedPaths.join(', ') || 'no paths'}${dependencyLabel}${effortLabel}${staleLabel} | ${
      task.summary || 'No summary'
    }`;
  }

  function renderStatus(board, options = {}) {
    const lines = [];
    const referenceIso = options.referenceIso ?? nowIso();
    const liveHeartbeats = options.liveHeartbeats ?? readAgentHeartbeats(referenceIso);
    const staleResources = Array.isArray(options.staleResources) ? options.staleResources : [];
    const watcherStatus = getWatcherStatus();
    const watcherAlive = isWatcherAlive(watcherStatus);

    lines.push(`Workspace: ${board.workspace}`);
    lines.push(`Updated: ${board.updatedAt}`);
    lines.push(
      `Watcher: ${
        watcherAlive
          ? `running (pid ${watcherStatus.pid})${watcherStatus.lastSweepAt ? ` | last sweep ${watcherStatus.lastSweepAt}` : ''}`
          : 'stopped'
      }`
    );
    lines.push('');
    lines.push('Agents:');

    for (const agent of board.agents) {
      const heartbeat = liveHeartbeats.get(agent.id);
      lines.push(
        `- ${agent.id}: ${agent.status}${agent.taskId ? ` (${agent.taskId})` : ''}${
          heartbeat ? ` | heartbeat ${formatElapsed(heartbeat.lastHeartbeatAt ?? heartbeat.startedAt ?? referenceIso, referenceIso)}` : ''
        }`
      );
    }

    const activeTasks = board.tasks.filter((task) => task.status === 'active');
    const blockedTasks = board.tasks.filter((task) => task.status === 'blocked');
    const reviewTasks = board.tasks.filter((task) => task.status === 'review');
    const waitingTasks = board.tasks.filter((task) => task.status === 'waiting');
    const plannedTasks = board.tasks.filter((task) => task.status === plannedTaskStatus);
    const handoffTasks = board.tasks.filter((task) => task.status === 'handoff');

    lines.push('');
    lines.push('Active tasks:');
    lines.push(activeTasks.length ? activeTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

    lines.push('');
    lines.push('Blocked tasks:');
    lines.push(blockedTasks.length ? blockedTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

    lines.push('');
    lines.push('Waiting tasks:');
    lines.push(waitingTasks.length ? waitingTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

    lines.push('');
    lines.push('Waiting details:');
    lines.push(waitingTasks.length ? renderWaitingDetailLines(board, waitingTasks, referenceIso).join('\n') : '- none');

    lines.push('');
    lines.push('Review tasks:');
    lines.push(reviewTasks.length ? reviewTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

    lines.push('');
    lines.push('Planned tasks:');
    lines.push(
      plannedTasks.length
        ? plannedTasks.map((task) => renderTaskLine(task, `suggested ${task.suggestedOwnerId ?? 'unassigned'}`, liveHeartbeats, referenceIso)).join('\n')
        : '- none'
    );

    lines.push('');
    lines.push('Handoff-ready tasks:');
    lines.push(
      handoffTasks.length
        ? handoffTasks.map((task) => `- ${task.id}: last owner ${task.lastOwnerId ?? 'unknown'} | ${task.summary || 'No summary'}`).join('\n')
        : '- none'
    );

    lines.push('');
    lines.push('Resource locks:');
    lines.push(
      board.resources.length
        ? board.resources
            .map((resource) => `- ${resource.name}: ${resource.ownerId}${resource.taskId ? ` (${resource.taskId})` : ''}${resource.expiresAt ? ` | expires ${resource.expiresAt}` : ''} | ${resource.reason}`)
            .join('\n')
        : '- none'
    );

    lines.push('');
    lines.push('Access requests:');
    lines.push(
      board.accessRequests.length
        ? board.accessRequests
            .map(
              (request) =>
                `- ${request.id}: ${request.status} | ${request.requestedBy}${request.taskId ? ` (${request.taskId})` : ''} | scope ${request.scope} | ${request.reason}`
            )
            .join('\n')
        : '- none'
    );

    lines.push('');
    lines.push('Assist opportunities:');
    const assistLines = collectAssistOpportunityLines(board, referenceIso);
    lines.push(assistLines.length ? assistLines.join('\n') : '- none');

    lines.push('');
    lines.push('Agent heartbeats:');
    lines.push(liveHeartbeats.size ? [...liveHeartbeats.values()].map((heartbeat) => renderHeartbeatLine(heartbeat, referenceIso)).join('\n') : '- none');

    lines.push('');
    lines.push('Incidents:');
    lines.push(
      board.incidents.length
        ? board.incidents
            .map(
              (incident) =>
                `- ${incident.key}: ${incident.status} | owner ${incident.ownerId}${incident.resource ? ` | resource ${incident.resource}` : ''} | ${incident.summary}`
            )
            .join('\n')
        : '- none'
    );

    if (staleResources.length) {
      lines.push('');
      lines.push(`Expired resource locks removed: ${staleResources.map((resource) => resource.name).join(', ')}`);
    }

    return lines.join('\n');
  }

  async function statusCommand() {
    const board = getReadOnlyBoard();
    const referenceIso = nowIso();
    const liveHeartbeats = readAgentHeartbeats(referenceIso, { cleanupStale: false });
    const staleResources = getStaleResources(board, liveHeartbeats, referenceIso);

    console.log(renderStatus(board, { referenceIso, liveHeartbeats, staleResources }));
  }

  return {
    buildDependencyInsight,
    buildLockContentionSummary,
    buildWaitingInsights,
    maybeQueueAssistMessages,
    statusCommand,
  };
}
