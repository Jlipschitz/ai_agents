import { nowIso } from './file-utils.mjs';

export function createRecoveryCommands(context) {
  const {
    appendJournalLine,
    autoHealExcludedCommands,
    getBoard,
    getReadOnlyBoard,
    hasLiveAgentHeartbeat,
    isIncidentStale,
    isReadOnlyCommand,
    isResourceStale,
    isTaskStale,
    note,
    readAgentHeartbeats,
    saveBoard,
    withMutationLock,
  } = context;

  function buildRecoveryReport(board, referenceIso = nowIso(), options = {}) {
    const liveHeartbeats = options.liveHeartbeats ?? readAgentHeartbeats(referenceIso, { cleanupStale: options.cleanupStale !== false });
    const staleTasks = board.tasks.filter((task) => isTaskStale(task, referenceIso) && !hasLiveAgentHeartbeat(task.ownerId, liveHeartbeats));
    const staleResources = board.resources.filter(
      (resource) => isResourceStale(resource, referenceIso) && !hasLiveAgentHeartbeat(resource.ownerId, liveHeartbeats)
    );
    const staleIncidents = board.incidents.filter(
      (incident) => isIncidentStale(incident, referenceIso) && !hasLiveAgentHeartbeat(incident.ownerId, liveHeartbeats)
    );

    return {
      staleTasks,
      staleResources,
      staleIncidents,
      liveHeartbeats,
    };
  }

  function renderRecoveryReport(report) {
    const lines = [];
    lines.push('Recovery report');
    lines.push('');
    lines.push('Stale tasks:');
    lines.push(
      report.staleTasks.length
        ? report.staleTasks.map((task) => `- ${task.id}: ${task.status}${task.ownerId ? ` | owner ${task.ownerId}` : ''}`).join('\n')
        : '- none'
    );
    lines.push('');
    lines.push('Stale resources:');
    lines.push(
      report.staleResources.length
        ? report.staleResources.map((resource) => `- ${resource.name}: ${resource.ownerId}${resource.taskId ? ` (${resource.taskId})` : ''}`).join('\n')
        : '- none'
    );
    lines.push('');
    lines.push('Stale incidents:');
    lines.push(
      report.staleIncidents.length
        ? report.staleIncidents.map((incident) => `- ${incident.key}: owner ${incident.ownerId}`).join('\n')
        : '- none'
    );

    return lines.join('\n');
  }

  function applyRecovery(board, report, timestamp = nowIso()) {
    for (const task of report.staleTasks) {
      const ownerId = task.ownerId;
      task.ownerId = null;
      task.status = 'handoff';
      task.lastOwnerId = ownerId ?? task.lastOwnerId ?? null;
      task.updatedAt = timestamp;
      task.waitingOn = [];
      task.lastHandoff = {
        at: timestamp,
        from: ownerId ?? 'recovery',
        to: null,
        body: 'Recovered after stale session or unexpected disconnect. Resume from task notes and verification log.',
      };
      note(task, 'recovery', 'recover', 'Task moved to handoff after stale session or unexpected disconnect.');

      if (ownerId) {
        const ownerAgent = board.agents.find((agent) => agent.id === ownerId);
        if (ownerAgent && ownerAgent.taskId === task.id) {
          ownerAgent.status = 'idle';
          ownerAgent.taskId = null;
          ownerAgent.updatedAt = timestamp;
        }
      }
    }

    if (report.staleResources.length) {
      board.resources = board.resources.filter((resource) => !report.staleResources.some((stale) => stale.name === resource.name));
    }

    for (const incident of report.staleIncidents) {
      incident.status = 'abandoned';
      incident.resolution = 'Marked abandoned during recovery after stale session or unexpected disconnect.';
      incident.updatedAt = timestamp;
    }
  }

  async function autoHealIfNeeded(commandName, options = {}) {
    if (autoHealExcludedCommands.has(commandName) || isReadOnlyCommand(commandName, options)) {
      return null;
    }

    return withMutationLock(async () => {
      const board = getBoard();
      const report = buildRecoveryReport(board);
      const total = report.staleTasks.length + report.staleResources.length + report.staleIncidents.length;

      if (!total) {
        return null;
      }

      const timestamp = nowIso();
      applyRecovery(board, report, timestamp);
      appendJournalLine(
        `- ${timestamp} | auto-heal applied before \`${commandName}\`: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
      );
      await saveBoard(board);

      return {
        commandName,
        staleTasks: report.staleTasks.length,
        staleResources: report.staleResources.length,
        staleIncidents: report.staleIncidents.length,
      };
    });
  }

  async function recoverCommand(options) {
    if (!options.apply) {
      const referenceIso = nowIso();
      const liveHeartbeats = readAgentHeartbeats(referenceIso, { cleanupStale: false });
      const report = buildRecoveryReport(getReadOnlyBoard(), referenceIso, { liveHeartbeats });
      console.log(renderRecoveryReport(report));
      console.log('\nRun with --apply to convert stale active work into handoff state and abandon stale incidents/resources.');
      return;
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const report = buildRecoveryReport(board);
      const timestamp = nowIso();
      applyRecovery(board, report, timestamp);

      appendJournalLine(
        `- ${timestamp} | recovery applied: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
      );
      await saveBoard(board);
      console.log(renderRecoveryReport(report));
      console.log('\nRecovery applied.');
    });
  }

  return { applyRecovery, autoHealIfNeeded, buildRecoveryReport, recoverCommand };
}
