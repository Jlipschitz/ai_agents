import { getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { ensureTaskMetadataDefaults, formatTaskDueAt } from './task-metadata.mjs';

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'review', 'waiting', 'handoff']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function taskLabel(task) {
  return task?.title ? `${task.id} - ${task.title}` : task?.id ?? 'unknown';
}

function latestVerificationByCheck(task) {
  const latest = new Map();
  for (const entry of array(task?.verificationLog)) {
    if (entry?.check) {
      latest.set(entry.check, entry);
    }
  }
  return latest;
}

function normalizeTask(task) {
  const normalized = {
    ...task,
    claimedPaths: array(task?.claimedPaths),
    dependencies: array(task?.dependencies),
    waitingOn: array(task?.waitingOn),
    verification: array(task?.verification),
    verificationLog: array(task?.verificationLog),
    relevantDocs: array(task?.relevantDocs),
    notes: array(task?.notes),
  };
  ensureTaskMetadataDefaults(normalized);
  return normalized;
}

function dependencyRows(board, task) {
  const tasks = array(board.tasks);
  const seen = new Set();
  const ids = [
    ...task.dependencies.map((taskId) => ({ taskId, relation: 'dependency' })),
    ...task.waitingOn.map((taskId) => ({ taskId, relation: 'waiting-on' })),
  ];

  return ids
    .filter(({ taskId, relation }) => {
      const key = `${relation}:${taskId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(({ taskId, relation }) => {
      const dependency = tasks.find((entry) => entry?.id === taskId);
      return {
        id: taskId,
        relation,
        exists: Boolean(dependency),
        status: dependency?.status ?? 'missing',
        ownerId: dependency?.ownerId ?? null,
        title: dependency?.title ?? '',
        summary: dependency?.summary ?? '',
        updatedAt: dependency?.updatedAt ?? null,
      };
    });
}

function verificationRows(task) {
  const latest = latestVerificationByCheck(task);
  return task.verification.map((check) => {
    const entry = latest.get(check);
    return {
      check,
      latestOutcome: entry?.outcome ?? entry?.status ?? null,
      latestAt: entry?.at ?? null,
      latestAgent: entry?.agent ?? null,
      details: entry?.details ?? '',
      artifactCount: array(entry?.artifacts).length,
    };
  });
}

function approvalRows(board, task) {
  return array(board.approvals)
    .filter((approval) => approval?.taskId === task.id)
    .map((approval) => ({
      id: approval.id,
      scope: approval.scope ?? '',
      status: approval.status ?? 'unknown',
      requestedBy: approval.requestedBy ?? null,
      decidedBy: approval.decidedBy ?? null,
      summary: approval.summary ?? '',
    }));
}

function recentNotes(task, limit = 5) {
  return task.notes.slice(-limit).map((note) => ({
    at: note?.at ?? null,
    agent: note?.agent ?? null,
    kind: note?.kind ?? 'note',
    body: note?.body ?? '',
  }));
}

function findPromptTask(board, agentId, explicitTaskId) {
  const tasks = array(board.tasks).map(normalizeTask);
  const agents = array(board.agents);
  const agent = agents.find((entry) => entry?.id === agentId) ?? null;

  if (explicitTaskId) {
    return {
      agent,
      task: tasks.find((entry) => entry.id === explicitTaskId) ?? null,
      reason: `task ${explicitTaskId}`,
    };
  }

  if (agent?.taskId) {
    return {
      agent,
      task: tasks.find((entry) => entry.id === agent.taskId) ?? null,
      reason: `agent assignment ${agent.taskId}`,
    };
  }

  const activeTask = tasks.find((entry) => entry.ownerId === agentId && ACTIVE_STATUSES.has(entry.status));
  return {
    agent,
    task: activeTask ?? null,
    reason: activeTask ? `active task ${activeTask.id}` : 'no active assignment',
  };
}

function buildRecommendations(task, dependencies, verification) {
  const recommendations = [];
  if (task.relevantDocs.length && !task.docsReviewedAt) {
    recommendations.push(`Review relevant docs and record with review-docs ${task.ownerId ?? '<agent>'} ${task.id}.`);
  }
  const openDependencies = dependencies.filter((entry) => entry.status !== 'done' && entry.status !== 'released');
  if (openDependencies.length) {
    recommendations.push(`Resolve or coordinate open dependencies: ${openDependencies.map((entry) => entry.id).join(', ')}.`);
  }
  const missingChecks = verification.filter((entry) => entry.latestOutcome !== 'pass');
  if (missingChecks.length) {
    recommendations.push(`Record passing verification for: ${missingChecks.map((entry) => entry.check).join(', ')}.`);
  }
  if (!recommendations.length) {
    recommendations.push('Keep changes within claimed paths, record progress, then finish or hand off when ready.');
  }
  return recommendations;
}

export function buildAgentPrompt(board, agentId, explicitTaskId = '') {
  const { agent, task, reason } = findPromptTask(board, agentId, explicitTaskId);
  if (!task) {
    return {
      ok: false,
      agentId,
      taskId: explicitTaskId || agent?.taskId || null,
      reason,
      error: explicitTaskId
        ? `Task ${explicitTaskId} was not found.`
        : `No active or assigned task was found for ${agentId}.`,
    };
  }

  const dependencies = dependencyRows(board, task);
  const verification = verificationRows(task);
  const approvals = approvalRows(board, task);
  const notes = recentNotes(task);
  const recommendations = buildRecommendations(task, dependencies, verification);
  const projectName = board.projectName || board.workspace || 'workspace';
  const prompt = renderAgentPrompt({
    agent,
    agentId,
    approvals,
    dependencies,
    notes,
    projectName,
    recommendations,
    task,
    verification,
  });

  return {
    ok: true,
    agentId,
    agentStatus: agent?.status ?? null,
    taskId: task.id,
    task,
    dependencies,
    approvals,
    verification,
    recentNotes: notes,
    recommendations,
    prompt,
  };
}

function bulletList(items, fallback = '- none') {
  return items.length ? items.map((entry) => `- ${entry}`).join('\n') : fallback;
}

function renderAgentPrompt({ agent, agentId, approvals, dependencies, notes, projectName, recommendations, task, verification }) {
  const dependencyLines = dependencies.map((entry) => {
    const owner = entry.ownerId ?? 'unowned';
    const title = entry.title ? ` - ${entry.title}` : '';
    const summary = entry.summary ? ` | ${entry.summary}` : '';
    return `${entry.id}${title}: ${entry.relation}, ${entry.status}, owner ${owner}${summary}`;
  });
  const verificationLines = verification.map((entry) => {
    const outcome = entry.latestOutcome ? `${entry.latestOutcome}${entry.latestAt ? ` at ${entry.latestAt}` : ''}` : 'not recorded';
    const artifacts = entry.artifactCount ? `, artifacts ${entry.artifactCount}` : '';
    return `${entry.check}: ${outcome}${artifacts}${entry.details ? ` | ${entry.details}` : ''}`;
  });
  const approvalLines = approvals.map((entry) => {
    const decided = entry.decidedBy ? `, decided by ${entry.decidedBy}` : '';
    return `${entry.id}: ${entry.status}, scope ${entry.scope}, requested by ${entry.requestedBy ?? 'unknown'}${decided}${entry.summary ? ` | ${entry.summary}` : ''}`;
  });
  const noteLines = notes.map((entry) => {
    const agentLabel = entry.agent ? `${entry.agent} ` : '';
    const timestamp = entry.at ? `${entry.at} | ` : '';
    return `${timestamp}${agentLabel}${entry.kind}: ${entry.body}`;
  });

  return [
    `# Agent Prompt: ${agentId}`,
    '',
    `Workspace: ${projectName}`,
    `Agent status: ${agent?.status ?? 'unknown'}${agent?.taskId ? ` (${agent.taskId})` : ''}`,
    `Assigned task: ${taskLabel(task)}`,
    `Task status: ${task.status ?? 'unknown'}`,
    `Owner: ${task.ownerId ?? 'unowned'}`,
    `Priority: ${task.priority}`,
    `Due: ${formatTaskDueAt(task.dueAt)}`,
    `Severity: ${task.severity}`,
    '',
    '## Objective',
    '',
    task.summary || task.rationale || 'No task summary is recorded.',
    '',
    '## Claimed Paths',
    '',
    bulletList(task.claimedPaths),
    '',
    '## Dependencies',
    '',
    bulletList(dependencyLines),
    '',
    '## Relevant Docs',
    '',
    bulletList(task.relevantDocs),
    `Docs reviewed: ${task.docsReviewedAt ? `yes (${task.docsReviewedAt}${task.docsReviewedBy ? ` by ${task.docsReviewedBy}` : ''})` : 'no'}`,
    '',
    '## Verification',
    '',
    bulletList(verificationLines),
    '',
    '## Approvals',
    '',
    bulletList(approvalLines),
    '',
    '## Recent Notes',
    '',
    bulletList(noteLines),
    '',
    '## Next Actions',
    '',
    bulletList(recommendations),
  ].join('\n');
}

export function runPromptCommand(argv, context) {
  const json = hasFlag(argv, '--json');
  const [agentId, taskId] = getPositionals(argv);
  if (!agentId) {
    return printCommandError('Usage: prompt <agent-id> [task-id] [--json]', { json });
  }

  const result = buildAgentPrompt(context.board, agentId, taskId ?? '');
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(result.prompt);
  } else {
    console.log(`# Agent Prompt: ${agentId}\n\n${result.error}`);
  }

  return result.ok ? 0 : 1;
}
