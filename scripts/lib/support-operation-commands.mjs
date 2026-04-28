import os from 'node:os';

import { nowIso } from './file-utils.mjs';

const DEFAULT_RESOURCE_TTL_MINUTES = 120;

function parseTtlMinutes(options = {}) {
  const raw = options['ttl-minutes'] ?? options.ttl ?? '';
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESOURCE_TTL_MINUTES;
}

function expiresAt(timestamp, ttlMinutes) {
  return new Date(Date.parse(timestamp) + ttlMinutes * 60000).toISOString();
}

function isResourceLeaseExpired(resource, referenceIso = nowIso()) {
  const expiresMs = Date.parse(resource.expiresAt ?? '');
  const referenceMs = Date.parse(referenceIso);
  return Number.isFinite(expiresMs) && Number.isFinite(referenceMs) && expiresMs <= referenceMs;
}

function applyResourceLease(resource, agentId, timestamp, ttlMinutes) {
  resource.ownerId = agentId;
  resource.ownerMachine = os.hostname();
  resource.ownerPid = process.pid;
  resource.ownerSessionId = process.env.AGENT_TERMINAL_ID || null;
  resource.ttlMinutes = ttlMinutes;
  resource.expiresAt = expiresAt(timestamp, ttlMinutes);
  resource.renewedAt = timestamp;
  resource.updatedAt = timestamp;
}

export function createSupportOperationCommands(context) {
  const {
    appendJournalLine,
    ensureTask,
    findActiveAccessRequestByScope,
    getAccessRequest,
    getAgent,
    getBoard,
    getCommandAgent,
    getTask,
    note,
    saveBoard,
    slugify,
    withMutationLock,
  } = context;

  async function reserveResourceCommand(positionals, options = {}) {
    const [agentId, resourceName, ...reasonParts] = positionals;
    const reason = reasonParts.join(' ').trim();
    const taskId = typeof options.task === 'string' ? options.task : null;
    const ttlMinutes = parseTtlMinutes(options);

    if (!agentId || !resourceName || !reason) {
      throw new Error('Usage: reserve-resource <agent> <resource> <reason> [--task <task-id>] [--ttl-minutes <minutes>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);

      if (taskId) {
        ensureTask(board, taskId);
      }

      const normalizedResource = slugify(resourceName);
      const timestamp = nowIso();
      const existing = board.resources.find((resource) => resource.name === normalizedResource);
      const existingExpired = existing && isResourceLeaseExpired(existing, timestamp);
      if (existing && existing.ownerId !== agentId && !existingExpired) {
        throw new Error(`Resource "${normalizedResource}" is already reserved by ${existing.ownerId}.`);
      }

      if (existing) {
        if (existing.ownerId !== agentId) {
          existing.previousOwnerId = existing.ownerId;
          existing.createdAt = timestamp;
        }
        existing.reason = reason;
        existing.taskId = taskId;
        applyResourceLease(existing, agentId, timestamp, ttlMinutes);
      } else {
        const resource = {
          name: normalizedResource,
          ownerId: agentId,
          taskId,
          reason,
          createdAt: timestamp,
        };
        applyResourceLease(resource, agentId, timestamp, ttlMinutes);
        board.resources.push(resource);
      }

      appendJournalLine(`- ${timestamp} | ${agentId} reserved resource \`${normalizedResource}\`${taskId ? ` for ${taskId}` : ''} until ${expiresAt(timestamp, ttlMinutes)}: ${reason}`);
      await saveBoard(board);
      console.log(`Reserved resource ${normalizedResource}.`);
    });
  }

  async function renewResourceCommand(positionals, options = {}) {
    const [agentId, resourceName] = positionals;

    if (!agentId || !resourceName) {
      throw new Error('Usage: renew-resource <agent> <resource> [--ttl-minutes <minutes>] [--reason <text>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);
      const normalizedResource = slugify(resourceName);
      const resource = board.resources.find((entry) => entry.name === normalizedResource);

      if (!resource) {
        throw new Error(`Resource "${normalizedResource}" is not reserved.`);
      }
      if (resource.ownerId !== agentId) {
        throw new Error(`${agentId} does not hold resource "${normalizedResource}".`);
      }

      const timestamp = nowIso();
      const ttlMinutes = parseTtlMinutes(options);
      const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
      if (reason) resource.reason = reason;
      applyResourceLease(resource, agentId, timestamp, ttlMinutes);

      appendJournalLine(`- ${timestamp} | ${agentId} renewed resource \`${normalizedResource}\` until ${resource.expiresAt}.`);
      await saveBoard(board);
      console.log(`Renewed resource ${normalizedResource}.`);
    });
  }

  async function releaseResourceCommand(positionals) {
    const [agentId, resourceName] = positionals;

    if (!agentId || !resourceName) {
      throw new Error('Usage: release-resource <agent> <resource>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);
      const normalizedResource = slugify(resourceName);
      const beforeCount = board.resources.length;
      board.resources = board.resources.filter((resource) => !(resource.name === normalizedResource && resource.ownerId === agentId));

      if (board.resources.length === beforeCount) {
        throw new Error(`${agentId} does not hold resource "${normalizedResource}".`);
      }

      const timestamp = nowIso();
      appendJournalLine(`- ${timestamp} | ${agentId} released resource \`${normalizedResource}\`.`);
      await saveBoard(board);
      console.log(`Released resource ${normalizedResource}.`);
    });
  }

  async function requestAccessCommand(positionals) {
    const [agentId, taskId, scope, ...reasonParts] = positionals;
    const reason = reasonParts.join(' ').trim();

    if (!agentId || !taskId || !scope || !reason) {
      throw new Error('Usage: request-access <agent> <task-id> <scope> <reason>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);

      if (task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot request access for "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
      }

      const normalizedScope = slugify(scope);
      const existing = findActiveAccessRequestByScope(board, normalizedScope);
      if (existing) {
        throw new Error(`Access scope "${normalizedScope}" already has an active request: ${existing.id} (${existing.status}).`);
      }

      const timestamp = nowIso();
      const requestId = `access-${agentId}-${normalizedScope}-${slugify(taskId)}-${Date.now()}`;
      board.accessRequests.push({
        id: requestId,
        scope: normalizedScope,
        status: 'pending',
        requestedBy: agentId,
        taskId,
        reason,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      });

      task.updatedAt = timestamp;
      note(task, agentId, 'access-request', `Requested privileged access for scope ${normalizedScope}. ${reason}`);
      agent.updatedAt = timestamp;
      appendJournalLine(`- ${timestamp} | ${agentId} requested access \`${requestId}\` for scope \`${normalizedScope}\`: ${reason}`);
      await saveBoard(board);
      console.log(`Created access request ${requestId}.`);
    });
  }

  async function resolveAccessRequestCommand(requestId, nextStatus, options) {
    if (!requestId) {
      throw new Error(`Usage: ${nextStatus}-access <request-id> [--by <agent>] [--note <text>]`);
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const request = getAccessRequest(board, requestId);

      if (!request) {
        throw new Error(`Unknown access request "${requestId}".`);
      }

      if (request.status !== 'pending' && nextStatus !== 'completed') {
        throw new Error(`Access request "${requestId}" is already ${request.status}.`);
      }

      if (nextStatus === 'completed' && request.status !== 'granted') {
        throw new Error(`Access request "${requestId}" must be granted before it can be completed.`);
      }

      const actingAgent = typeof options.by === 'string' ? options.by : 'system';
      if (actingAgent !== 'system') {
        getAgent(board, actingAgent);
      }
      const noteText = typeof options.note === 'string' ? options.note.trim() : '';
      const timestamp = nowIso();
      request.status = nextStatus;
      request.updatedAt = timestamp;
      request.resolvedAt = timestamp;
      request.resolvedBy = actingAgent;
      request.resolutionNote = noteText || null;

      const task = request.taskId ? getTask(board, request.taskId) : null;
      if (task) {
        task.updatedAt = timestamp;
        note(task, actingAgent, `access-${nextStatus}`, `${nextStatus} privileged access for scope ${request.scope}.${noteText ? ` ${noteText}` : ''}`);
      }

      appendJournalLine(
        `- ${timestamp} | ${actingAgent} ${nextStatus} access \`${requestId}\`${noteText ? `: ${noteText}` : ''}`
      );
      await saveBoard(board);
      console.log(`Marked access request ${requestId} as ${nextStatus}.`);
    });
  }

  async function grantAccessCommand(positionals, options) {
    await resolveAccessRequestCommand(positionals[0], 'granted', options);
  }

  async function denyAccessCommand(positionals, options) {
    await resolveAccessRequestCommand(positionals[0], 'denied', options);
  }

  async function completeAccessCommand(positionals, options) {
    await resolveAccessRequestCommand(positionals[0], 'completed', options);
  }

  async function startIncidentCommand(positionals, options) {
    const [agentId, incidentKeyRaw, ...summaryParts] = positionals;
    const summary = summaryParts.join(' ').trim();
    const incidentKey = slugify(incidentKeyRaw ?? '');
    const resource = typeof options.resource === 'string' ? slugify(options.resource) : null;
    const taskId = typeof options.task === 'string' ? options.task : null;

    if (!agentId || !incidentKey || !summary) {
      throw new Error('Usage: start-incident <agent> <incident-key> <summary> [--resource <name>] [--task <task-id>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);

      if (taskId) {
        ensureTask(board, taskId);
      }

      const existing = board.incidents.find((incident) => incident.key === incidentKey && incident.status === 'open');
      if (existing) {
        throw new Error(`Incident "${incidentKey}" is already open and owned by ${existing.ownerId}.`);
      }

      const timestamp = nowIso();
      board.incidents.push({
        key: incidentKey,
        ownerId: agentId,
        participants: [agentId],
        taskId,
        resource,
        status: 'open',
        summary,
        resolution: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      if (resource) {
        const existingResource = board.resources.find((entry) => entry.name === resource);
        if (existingResource && existingResource.ownerId !== agentId) {
          throw new Error(`Resource "${resource}" is already reserved by ${existingResource.ownerId}.`);
        }

        if (existingResource) {
          existingResource.reason = `Incident ${incidentKey}: ${summary}`;
          existingResource.taskId = taskId;
          applyResourceLease(existingResource, agentId, timestamp, parseTtlMinutes(options));
        } else {
          const resourceEntry = {
            name: resource,
            ownerId: agentId,
            taskId,
            reason: `Incident ${incidentKey}: ${summary}`,
            createdAt: timestamp,
          };
          applyResourceLease(resourceEntry, agentId, timestamp, parseTtlMinutes(options));
          board.resources.push(resourceEntry);
        }
      }

      appendJournalLine(`- ${timestamp} | ${agentId} started incident \`${incidentKey}\`: ${summary}`);
      await saveBoard(board);
      console.log(`Started incident ${incidentKey}.`);
    });
  }

  async function joinIncidentCommand(positionals, options) {
    const [agentId, incidentKeyRaw] = positionals;
    const incidentKey = slugify(incidentKeyRaw ?? '');
    const taskId = typeof options.task === 'string' ? options.task : null;

    if (!agentId || !incidentKey) {
      throw new Error('Usage: join-incident <agent> <incident-key> [--task <task-id>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);

      if (taskId) {
        ensureTask(board, taskId);
      }

      const incident = board.incidents.find((entry) => entry.key === incidentKey && entry.status === 'open');
      if (!incident) {
        throw new Error(`Incident "${incidentKey}" is not open.`);
      }

      incident.participants = [...new Set([...(incident.participants ?? []), agentId])];
      incident.updatedAt = nowIso();
      if (!incident.taskId && taskId) {
        incident.taskId = taskId;
      }

      appendJournalLine(`- ${incident.updatedAt} | ${agentId} joined incident \`${incidentKey}\`.`);
      await saveBoard(board);
      console.log(`Joined incident ${incidentKey}.`);
    });
  }

  async function closeIncidentCommand(positionals) {
    const [agentId, incidentKeyRaw, ...resolutionParts] = positionals;
    const incidentKey = slugify(incidentKeyRaw ?? '');
    const resolution = resolutionParts.join(' ').trim();

    if (!agentId || !incidentKey || !resolution) {
      throw new Error('Usage: close-incident <agent> <incident-key> <resolution>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);

      const incident = board.incidents.find((entry) => entry.key === incidentKey && entry.status === 'open');
      if (!incident) {
        throw new Error(`Incident "${incidentKey}" is not open.`);
      }

      if (incident.ownerId !== agentId) {
        throw new Error(`${agentId} cannot close incident "${incidentKey}" because it is owned by ${incident.ownerId}.`);
      }

      const timestamp = nowIso();
      incident.status = 'closed';
      incident.resolution = resolution;
      incident.updatedAt = timestamp;

      if (incident.resource) {
        board.resources = board.resources.filter((resource) => !(resource.name === incident.resource && resource.ownerId === incident.ownerId));
      }

      appendJournalLine(`- ${timestamp} | ${agentId} closed incident \`${incidentKey}\`: ${resolution}`);
      await saveBoard(board);
      console.log(`Closed incident ${incidentKey}.`);
    });
  }

  return {
    closeIncidentCommand,
    completeAccessCommand,
    denyAccessCommand,
    grantAccessCommand,
    joinIncidentCommand,
    releaseResourceCommand,
    renewResourceCommand,
    requestAccessCommand,
    reserveResourceCommand,
    startIncidentCommand,
  };
}
