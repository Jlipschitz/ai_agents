import { nowIso } from './file-utils.mjs';

import { VALID_APPROVAL_STATUSES } from './approval-ledger-commands.mjs';
import { isValidTaskDueAt, isValidTaskPriority, isValidTaskSeverity } from './task-metadata.mjs';

export function createBoardValidation(context) {
  const {
    activeTaskStatuses,
    agentIds,
    docReviewRequiredStatuses,
    ensureTaskDefaults,
    getMissingVisualPassingChecks,
    getTask,
    hasLiveAgentHeartbeat,
    hasVisualCheck,
    hasVisualImpact,
    hasVisualVerificationCompanion,
    isIncidentStale,
    isResourceStale,
    isTaskStale,
    pathsOverlap,
    readAgentHeartbeats,
    resourceStaleHours,
    staleIncidentHours,
    staleTaskHours,
    validAccessStatuses,
    validIncidentStatuses,
    validTaskStatuses,
    visualRequiredChecks,
  } = context;

  function getLatestVerificationOutcomes(task) {
    ensureTaskDefaults(task);
    const latestByCheck = new Map();

    for (const entry of task.verificationLog) {
      if (typeof entry?.check !== 'string' || typeof entry?.outcome !== 'string') {
        continue;
      }
      latestByCheck.set(entry.check, entry.outcome.toLowerCase());
    }

    if (task.docsReviewedAt && latestByCheck.get('docs-review') !== 'fail') {
      latestByCheck.set('docs-review', 'pass');
    }

    return latestByCheck;
  }

  function hasAnyVerificationRecord(task) {
    ensureTaskDefaults(task);
    return Boolean(task.docsReviewedAt) || task.verificationLog.some((entry) => typeof entry?.check === 'string' && typeof entry?.outcome === 'string');
  }

  function getMissingPassingVerificationChecks(task) {
    const latestByCheck = getLatestVerificationOutcomes(task);
    return task.verification.filter((check) => latestByCheck.get(check) !== 'pass');
  }

  function getLatestFailingVerificationChecks(task) {
    const latestByCheck = getLatestVerificationOutcomes(task);
    return [...latestByCheck.entries()].filter(([, outcome]) => outcome === 'fail').map(([check]) => check);
  }

  function validateBoard(board, options = {}) {
    const findings = [];
    const referenceIso = nowIso();
    const liveHeartbeats = options.liveHeartbeats ?? readAgentHeartbeats(referenceIso, { cleanupStale: false });

    for (const task of board.tasks) {
      ensureTaskDefaults(task);
    }

    const taskIds = new Set();
    for (const task of board.tasks) {
      if (!task.id || typeof task.id !== 'string') {
        findings.push('A task is missing a string id.');
        continue;
      }

      if (taskIds.has(task.id)) {
        findings.push(`Task id "${task.id}" is duplicated.`);
      }
      taskIds.add(task.id);

      if (!validTaskStatuses.has(task.status)) {
        findings.push(`Task "${task.id}" has unknown status "${task.status}".`);
      }

      if (!isValidTaskPriority(task.priority)) {
        findings.push(`Task "${task.id}" has invalid priority "${task.priority}".`);
      }

      if (!isValidTaskSeverity(task.severity)) {
        findings.push(`Task "${task.id}" has invalid severity "${task.severity}".`);
      }

      if (!isValidTaskDueAt(task.dueAt)) {
        findings.push(`Task "${task.id}" has invalid dueAt "${task.dueAt}".`);
      }

      if (activeTaskStatuses.has(task.status) && !task.ownerId) {
        findings.push(`Task "${task.id}" is ${task.status} but has no owner.`);
      }

      if (task.ownerId) {
        const ownerAgent = board.agents.find((agent) => agent.id === task.ownerId);
        if (!ownerAgent) {
          findings.push(`Task "${task.id}" is owned by unknown agent "${task.ownerId}".`);
        } else if (ownerAgent.taskId !== task.id) {
          findings.push(`Task "${task.id}" says owner is "${task.ownerId}" but that agent is pointed at "${ownerAgent.taskId ?? 'nothing'}".`);
        }
      }

      for (const dependencyId of task.dependencies) {
        if (!getTask(board, dependencyId)) {
          findings.push(`Task "${task.id}" depends on missing task "${dependencyId}".`);
        }
      }

      if (task.dependencies.includes(task.id)) {
        findings.push(`Task "${task.id}" depends on itself.`);
      }

      if (isTaskStale(task, referenceIso) && !hasLiveAgentHeartbeat(task.ownerId, liveHeartbeats)) {
        findings.push(`Task "${task.id}" is stale; no update for at least ${staleTaskHours} hours.`);
      }

      if (task.status === 'review' && !task.verification.length) {
        findings.push(`Task "${task.id}" is review but has no verification intent recorded.`);
      }

      if (hasVisualImpact(task.claimedPaths) && !hasVisualCheck(task.verification) && !hasVisualVerificationCompanion(board, task)) {
        findings.push(
          `Task "${task.id}" touches UI or visual-suite paths but has no visual verification intent. Add ${visualRequiredChecks.join(
            ', '
          )} or coordinate a dependent visual verification task.`
        );
      }

      if (task.status === 'done') {
        if (!task.verification.length && !hasAnyVerificationRecord(task)) {
          findings.push(`Task "${task.id}" is done but has no verification intent or verification result recorded.`);
        }

        const missingVisualChecks = getMissingVisualPassingChecks(board, task);
        if (missingVisualChecks.length) {
          findings.push(`Task "${task.id}" is done but lacks passing visual verification for: ${missingVisualChecks.join(', ')}.`);
        }

        const missingChecks = getMissingPassingVerificationChecks(task).filter((check) => !missingVisualChecks.includes(check));
        if (missingChecks.length) {
          findings.push(`Task "${task.id}" is done but lacks passing verification for: ${missingChecks.join(', ')}.`);
        }

        const failingChecks = getLatestFailingVerificationChecks(task);
        if (failingChecks.length) {
          findings.push(`Task "${task.id}" has latest failing verification for: ${failingChecks.join(', ')}.`);
        }
      }

      if (task.status === 'waiting' && !task.waitingOn.length) {
        findings.push(`Task "${task.id}" is waiting but has no waited-on tasks recorded.`);
      }

      if (docReviewRequiredStatuses.has(task.status) && task.relevantDocs.length && !task.docsReviewedAt) {
        findings.push(`Task "${task.id}" has relevant docs but no recorded docs review: ${task.relevantDocs.join(', ')}.`);
      }
    }

    const seenAgentIds = new Set();
    for (const agent of board.agents) {
      if (!agent.id || typeof agent.id !== 'string') {
        findings.push('An agent is missing a string id.');
        continue;
      }

      if (seenAgentIds.has(agent.id)) {
        findings.push(`Agent id "${agent.id}" is duplicated.`);
      }
      seenAgentIds.add(agent.id);

      if (!agentIds.includes(agent.id)) {
        findings.push(`Agent "${agent.id}" is not a supported slot. Expected one of: ${agentIds.join(', ')}.`);
      }

      if (agent.taskId && !getTask(board, agent.taskId)) {
        findings.push(`Agent "${agent.id}" points to missing task "${agent.taskId}".`);
        continue;
      }

      if (agent.taskId) {
        const task = getTask(board, agent.taskId);
        if (task?.ownerId !== agent.id) {
          findings.push(`Agent "${agent.id}" points to task "${agent.taskId}" but that task owner is "${task?.ownerId ?? 'nobody'}".`);
        }
      }
    }

    const claimedTasks = board.tasks.filter((task) => task.ownerId && activeTaskStatuses.has(task.status));
    for (let leftIndex = 0; leftIndex < claimedTasks.length; leftIndex += 1) {
      const leftTask = claimedTasks[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < claimedTasks.length; rightIndex += 1) {
        const rightTask = claimedTasks[rightIndex];
        const overlap = leftTask.claimedPaths.find((leftPath) => rightTask.claimedPaths.some((rightPath) => pathsOverlap(leftPath, rightPath)));

        if (overlap) {
          findings.push(`Active path overlap between "${leftTask.id}" and "${rightTask.id}" on "${overlap}".`);
        }
      }
    }

    const activeIssueKeys = new Map();
    for (const task of claimedTasks) {
      if (!task.issueKey) {
        continue;
      }
      if (!activeIssueKeys.has(task.issueKey)) {
        activeIssueKeys.set(task.issueKey, []);
      }
      activeIssueKeys.get(task.issueKey).push(task.id);
    }
    for (const [issueKey, relatedTaskIds] of activeIssueKeys.entries()) {
      if (relatedTaskIds.length > 1) {
        findings.push(`Multiple active tasks share issue key "${issueKey}": ${relatedTaskIds.join(', ')}.`);
      }
    }

    const resourceKeys = new Set();
    for (const resource of board.resources) {
      if (!resource.name || !resource.ownerId) {
        findings.push('A resource lock is missing name or owner.');
        continue;
      }
      if (!board.agents.find((agent) => agent.id === resource.ownerId)) {
        findings.push(`Resource "${resource.name}" references unknown owner "${resource.ownerId}".`);
      }
      if (isResourceStale(resource, referenceIso) && !hasLiveAgentHeartbeat(resource.ownerId, liveHeartbeats)) {
        findings.push(`Resource "${resource.name}" is stale; no update for at least ${resourceStaleHours} hours.`);
      }
      if (resourceKeys.has(resource.name)) {
        findings.push(`Resource "${resource.name}" is reserved more than once.`);
      }
      resourceKeys.add(resource.name);
    }

    const openAccessScopes = new Set();
    const accessRequestIds = new Set();
    for (const request of board.accessRequests) {
      if (!request.id || !request.scope || !request.status || !request.requestedBy) {
        findings.push('An access request is missing required fields.');
        continue;
      }

      if (!validAccessStatuses.has(request.status)) {
        findings.push(`Access request "${request.id}" has unknown status "${request.status}".`);
      }

      if (accessRequestIds.has(request.id)) {
        findings.push(`Access request id "${request.id}" is duplicated.`);
      }
      accessRequestIds.add(request.id);

      if (!board.agents.find((agent) => agent.id === request.requestedBy)) {
        findings.push(`Access request "${request.id}" references unknown requester "${request.requestedBy}".`);
      }

      if (request.taskId && !getTask(board, request.taskId)) {
        findings.push(`Access request "${request.id}" references missing task "${request.taskId}".`);
      }

      if (request.status === 'pending') {
        if (openAccessScopes.has(request.scope)) {
          findings.push(`Multiple pending access requests share scope "${request.scope}".`);
        }
        openAccessScopes.add(request.scope);
      }
    }

    const approvalIds = new Set();
    for (const approval of board.approvals ?? []) {
      if (!approval?.id || !approval.taskId || !approval.scope || !approval.status || !approval.requestedBy) {
        findings.push('An approval ledger entry is missing id, taskId, scope, status, or requestedBy.');
        continue;
      }
      if (approvalIds.has(approval.id)) {
        findings.push(`Approval id "${approval.id}" is duplicated.`);
      }
      approvalIds.add(approval.id);
      if (!VALID_APPROVAL_STATUSES.has(approval.status)) {
        findings.push(`Approval "${approval.id}" has unknown status "${approval.status}".`);
      }
      if (!getTask(board, approval.taskId)) {
        findings.push(`Approval "${approval.id}" references missing task "${approval.taskId}".`);
      }
      if (!board.agents.find((agent) => agent.id === approval.requestedBy)) {
        findings.push(`Approval "${approval.id}" references unknown requester "${approval.requestedBy}".`);
      }
      for (const [field, agentId] of [['decidedBy', approval.decidedBy], ['usedBy', approval.usedBy]]) {
        if (agentId && !board.agents.find((agent) => agent.id === agentId)) {
          findings.push(`Approval "${approval.id}" references unknown ${field} "${agentId}".`);
        }
      }
    }

    const openIncidentKeys = new Set();
    for (const incident of board.incidents) {
      if (!incident.key || !incident.ownerId || !incident.status) {
        findings.push('An incident is missing key, owner, or status.');
        continue;
      }
      if (!validIncidentStatuses.has(incident.status)) {
        findings.push(`Incident "${incident.key}" has unknown status "${incident.status}".`);
      }
      if (!board.agents.find((agent) => agent.id === incident.ownerId)) {
        findings.push(`Incident "${incident.key}" references unknown owner "${incident.ownerId}".`);
      }
      for (const participant of incident.participants ?? []) {
        if (!board.agents.find((agent) => agent.id === participant)) {
          findings.push(`Incident "${incident.key}" references unknown participant "${participant}".`);
        }
      }
      if (incident.status === 'open') {
        if (openIncidentKeys.has(incident.key)) {
          findings.push(`Incident "${incident.key}" is open more than once.`);
        }
        openIncidentKeys.add(incident.key);
      }
      if (isIncidentStale(incident, referenceIso) && !hasLiveAgentHeartbeat(incident.ownerId, liveHeartbeats)) {
        findings.push(`Incident "${incident.key}" is stale; no update for at least ${staleIncidentHours} hours.`);
      }
    }

    return findings;
  }

  return {
    getLatestVerificationOutcomes,
    validateBoard,
  };
}
