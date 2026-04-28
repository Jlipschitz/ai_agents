import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { buildAgentPrompt } from './prompt-commands.mjs';
import { applyPromptPrivacy, getPrivacyOptions } from './privacy-utils.mjs';
import { formatTaskDueAt, taskUrgencyScore } from './task-metadata.mjs';

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);
const VALUED_FLAGS = new Set(['--task', '--cli']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value) {
  return array(value).filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
}

function taskTitle(task) {
  return task?.title || task?.summary || task?.id || 'unknown task';
}

function taskLabel(task) {
  return task?.title ? `${task.id} - ${task.title}` : task?.id ?? 'unknown';
}

function taskById(board, taskId) {
  return array(board?.tasks).find((task) => task?.id === taskId) ?? null;
}

function agentById(board, agentId) {
  return array(board?.agents).find((agent) => agent?.id === agentId) ?? null;
}

function latestVerificationByCheck(task) {
  const latest = new Map();
  for (const entry of array(task?.verificationLog)) {
    if (entry?.check) latest.set(entry.check, entry);
  }
  return latest;
}

function verificationRows(task) {
  const checks = stringArray(task?.verification);
  const latest = latestVerificationByCheck(task);
  return checks.map((check) => {
    const entry = latest.get(check);
    return {
      check,
      latestOutcome: entry?.outcome ?? entry?.status ?? null,
      latestAt: entry?.at ?? null,
      latestAgent: entry?.agent ?? null,
      details: entry?.details ?? '',
      artifactCount: array(entry?.artifacts).length,
      passed: (entry?.outcome ?? entry?.status) === 'pass',
    };
  });
}

function openDependencies(board, task) {
  const ids = [...stringArray(task?.dependencies), ...stringArray(task?.waitingOn)];
  const seen = new Set();
  return ids
    .filter((taskId) => {
      if (seen.has(taskId)) return false;
      seen.add(taskId);
      return true;
    })
    .map((taskId) => {
      const dependency = taskById(board, taskId);
      return {
        id: taskId,
        exists: Boolean(dependency),
        status: dependency?.status ?? 'missing',
        ownerId: dependency?.ownerId ?? null,
        title: dependency ? taskTitle(dependency) : '',
        open: !dependency || !TERMINAL_STATUSES.has(dependency.status),
      };
    })
    .filter((entry) => entry.open);
}

function pendingApprovals(board, task) {
  return array(board?.approvals)
    .filter((approval) => approval?.taskId === task?.id && approval.status !== 'approved' && approval.status !== 'used')
    .map((approval) => ({
      id: approval.id,
      scope: approval.scope ?? '',
      status: approval.status ?? 'unknown',
      summary: approval.summary ?? '',
    }));
}

function docsNeedReview(task) {
  return stringArray(task?.relevantDocs).length > 0 && !task?.docsReviewedAt;
}

function missingVerification(task) {
  return verificationRows(task).filter((entry) => !entry.passed);
}

function dependenciesSatisfied(board, task) {
  return openDependencies(board, task).length === 0;
}

function readyPlannedTasks(board, agentId) {
  return array(board?.tasks)
    .filter((task) => task?.status === 'planned' && !task.ownerId && dependenciesSatisfied(board, task))
    .sort((left, right) => {
      const suggested = Number(right.suggestedOwnerId === agentId) - Number(left.suggestedOwnerId === agentId);
      if (suggested !== 0) return suggested;
      return taskUrgencyScore(right) - taskUrgencyScore(left) || String(left.id).localeCompare(String(right.id));
    });
}

function findAgentTask(board, agentId, explicitTaskId = '') {
  if (explicitTaskId) return taskById(board, explicitTaskId);
  const agent = agentById(board, agentId);
  if (agent?.taskId) {
    const assigned = taskById(board, agent.taskId);
    if (assigned) return assigned;
  }
  return array(board?.tasks).find((task) => task?.ownerId === agentId && ACTIVE_STATUSES.has(task.status)) ?? null;
}

function findWorkspaceTask(board) {
  const tasks = array(board?.tasks);
  return tasks.find((task) => task?.status === 'blocked')
    ?? tasks.find((task) => task?.status === 'waiting')
    ?? tasks.find((task) => task?.status === 'review')
    ?? tasks.find((task) => task?.status === 'handoff')
    ?? tasks.find((task) => task?.status === 'active')
    ?? readyPlannedTasks(board, '')[0]
    ?? null;
}

function quoteArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function commandString(args, cli) {
  return `${cli} ${args.map(quoteArg).join(' ')}`;
}

function recommendation(category, reason, args, options = {}) {
  const cli = options.cli || 'npm run agents --';
  return {
    ok: true,
    category,
    reason,
    agentId: options.agentId || null,
    taskId: options.taskId || null,
    command: commandString(args, cli),
    args,
  };
}

function recommendForTask(board, task, agentId, options = {}) {
  const actor = agentId || task.ownerId || task.lastOwnerId || task.lastHandoff?.to || '<agent-id>';
  const taskId = task.id;
  const openDeps = openDependencies(board, task);
  const approvals = pendingApprovals(board, task);
  const missingChecks = missingVerification(task);
  const paths = stringArray(task.claimedPaths);
  const docs = stringArray(task.relevantDocs);
  const context = { ...options, agentId: actor, taskId };

  if (task.status === 'planned') {
    return recommendation(
      'claim',
      `${taskId} is planned and ready to claim.`,
      ['claim', actor, taskId, '--paths', paths.join(',') || '.', '--summary', taskTitle(task)],
      context
    );
  }

  if (openDeps.length) {
    return recommendation(
      'escalate',
      `${taskId} has open dependencies: ${openDeps.map((entry) => entry.id).join(', ')}.`,
      ['escalation-route', '--task', taskId, '--reason', 'open dependencies'],
      context
    );
  }

  if (approvals.length) {
    return recommendation(
      'approval',
      `${taskId} has pending approval work: ${approvals.map((entry) => entry.id).join(', ')}.`,
      ['approvals', 'check', taskId],
      context
    );
  }

  if (task.status === 'blocked' || task.status === 'waiting') {
    return recommendation(
      'escalate',
      `${taskId} is ${task.status}; route the blocker before more implementation work.`,
      ['escalation-route', '--task', taskId, '--reason', task.status],
      context
    );
  }

  if (task.status === 'handoff' && (!task.ownerId || task.ownerId !== actor)) {
    return recommendation(
      'handoff',
      `${taskId} is ready for handoff context.`,
      ['prompt', actor, taskId],
      context
    );
  }

  if (docsNeedReview(task)) {
    return recommendation(
      'docs-review',
      `${taskId} has relevant docs that have not been reviewed.`,
      ['review-docs', actor, taskId, '--docs', docs.join(','), '--note', 'Reviewed relevant docs.'],
      context
    );
  }

  if (missingChecks.length) {
    const check = missingChecks[0].check;
    return recommendation(
      'verification',
      `${taskId} is missing passing verification for ${check}.`,
      ['verify', actor, taskId, check, 'pass', '--details', `${check} passed.`],
      context
    );
  }

  if (task.status === 'review') {
    return recommendation(
      'finish',
      `${taskId} is in review with required docs and verification satisfied.`,
      ['finish', actor, taskId, '--require-verification', '--require-doc-review', 'Review complete.'],
      context
    );
  }

  if (TERMINAL_STATUSES.has(task.status)) {
    return recommendation(
      'release-check',
      `${taskId} is ${task.status}; check release readiness before packaging handoff output.`,
      ['release-check', taskId],
      { ...options, agentId: actor, taskId }
    );
  }

  return recommendation(
    'progress',
    `${taskId} is active and no immediate gate is missing.`,
    ['progress', actor, taskId, 'Progress updated.'],
    context
  );
}

export function buildNextCommandRecommendation(board, options = {}) {
  const agentId = options.agentId || '';
  const explicitTaskId = options.taskId || '';
  const task = agentId ? findAgentTask(board, agentId, explicitTaskId) : (explicitTaskId ? taskById(board, explicitTaskId) : findWorkspaceTask(board));

  if (task) {
    return {
      generatedAt: new Date().toISOString(),
      ...recommendForTask(board, task, agentId, options),
      task: summarizeTask(task),
    };
  }

  if (agentId) {
    const planned = readyPlannedTasks(board, agentId)[0];
    if (planned) {
      return {
        generatedAt: new Date().toISOString(),
        ...recommendForTask(board, planned, agentId, options),
        task: summarizeTask(planned),
      };
    }
  }

  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    agentId: agentId || null,
    taskId: explicitTaskId || null,
    error: explicitTaskId
      ? `Task ${explicitTaskId} was not found.`
      : agentId
        ? `No active or ready task was found for ${agentId}.`
        : 'No recommended next command was found.',
  };
}

function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title ?? '',
    summary: task.summary ?? '',
    status: task.status ?? 'unknown',
    ownerId: task.ownerId ?? null,
    lastOwnerId: task.lastOwnerId ?? null,
    claimedPaths: stringArray(task.claimedPaths),
    priority: task.priority ?? 'normal',
    dueAt: task.dueAt ?? null,
    severity: task.severity ?? 'none',
    updatedAt: task.updatedAt ?? null,
  };
}

function latestNotes(task, limit = 6) {
  return array(task?.notes).slice(-limit).map((note) => ({
    at: note?.at ?? null,
    agent: note?.agent ?? null,
    kind: note?.kind ?? 'note',
    body: note?.body ?? note?.note ?? '',
  }));
}

function buildBlockers(board, task) {
  const blockers = [];
  for (const dependency of openDependencies(board, task)) {
    blockers.push(`Open dependency ${dependency.id} (${dependency.status})${dependency.ownerId ? ` owned by ${dependency.ownerId}` : ''}.`);
  }
  for (const approval of pendingApprovals(board, task)) {
    blockers.push(`Approval ${approval.id} is ${approval.status}${approval.scope ? ` for ${approval.scope}` : ''}.`);
  }
  if (task.status === 'blocked' || task.status === 'waiting') {
    blockers.push(`Task is currently ${task.status}.`);
  }
  return blockers;
}

function renderRows(rows, fallback = '- none') {
  return rows.length ? rows.map((row) => `- ${row}`).join('\n') : fallback;
}

function renderHandoffBundle(bundle) {
  const task = bundle.task;
  const verification = bundle.verification.map((entry) => {
    const outcome = entry.latestOutcome ? `${entry.latestOutcome}${entry.latestAt ? ` at ${entry.latestAt}` : ''}` : 'not recorded';
    return `${entry.check}: ${outcome}${entry.details ? ` - ${entry.details}` : ''}`;
  });
  const notes = bundle.latestNotes.map((note) => {
    const actor = note.agent ? `${note.agent} ` : '';
    const when = note.at ? `${note.at} | ` : '';
    return `${when}${actor}${note.kind}: ${note.body}`;
  });
  return [
    `# Handoff Bundle: ${task.id}`,
    '',
    `Workspace: ${bundle.projectName}`,
    `For agent: ${bundle.agentId}`,
    `Task: ${taskLabel(task)}`,
    `Status: ${task.status}`,
    `Owner: ${task.ownerId ?? 'unowned'}`,
    `Last owner: ${task.lastOwnerId ?? 'none'}`,
    `Priority: ${task.priority}`,
    `Due: ${formatTaskDueAt(task.dueAt)}`,
    `Severity: ${task.severity}`,
    '',
    '## Objective',
    '',
    task.summary || 'No task summary is recorded.',
    '',
    '## Claimed Paths',
    '',
    renderRows(task.claimedPaths),
    '',
    '## Blockers',
    '',
    renderRows(bundle.blockers),
    '',
    '## Verification',
    '',
    renderRows(verification),
    '',
    '## Docs',
    '',
    renderRows(bundle.docs.relevantDocs),
    `Reviewed: ${bundle.docs.reviewed ? `yes (${bundle.docs.reviewedAt}${bundle.docs.reviewedBy ? ` by ${bundle.docs.reviewedBy}` : ''})` : 'no'}`,
    '',
    '## Recent Notes',
    '',
    renderRows(notes),
    '',
    '## Recommended Next Command',
    '',
    bundle.recommendation.ok ? bundle.recommendation.command : bundle.recommendation.error,
    '',
    bundle.recommendation.ok ? `Reason: ${bundle.recommendation.reason}` : '',
    '',
    '## Copy/Paste Prompt',
    '',
    bundle.prompt,
  ].filter((line) => line !== '').join('\n');
}

export function buildHandoffBundle(board, agentId, taskId, options = {}) {
  const task = taskById(board, taskId);
  if (!task) {
    return {
      ok: false,
      agentId,
      taskId,
      error: `Task ${taskId} was not found.`,
    };
  }

  const recommendation = buildNextCommandRecommendation(board, { ...options, agentId, taskId });
  const prompt = buildAgentPrompt(board, agentId, taskId);
  const bundle = {
    ok: true,
    generatedAt: new Date().toISOString(),
    projectName: board.projectName || board.workspace || 'workspace',
    agentId,
    taskId,
    task: summarizeTask(task),
    blockers: buildBlockers(board, task),
    verification: verificationRows(task),
    docs: {
      relevantDocs: stringArray(task.relevantDocs),
      reviewed: Boolean(task.docsReviewedAt),
      reviewedAt: task.docsReviewedAt ?? null,
      reviewedBy: task.docsReviewedBy ?? null,
    },
    latestNotes: latestNotes(task),
    recommendation,
    prompt: prompt.ok ? prompt.prompt : prompt.error,
  };
  bundle.bundle = renderHandoffBundle(bundle);
  return bundle;
}

export function runNextCommand(argv, context) {
  const json = hasFlag(argv, '--json');
  const [agentId] = getPositionals(argv, VALUED_FLAGS);
  const taskId = getFlagValue(argv, '--task', '');
  const cli = getFlagValue(argv, '--cli', 'npm run agents --');
  const privacy = getPrivacyOptions(context.config);
  const board = applyPromptPrivacy(context.board, privacy);
  const result = buildNextCommandRecommendation(board, { agentId: agentId ?? '', taskId, cli });
  result.privacy = privacy;

  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`# Next Command\n\nRecommended:\n${result.command}\n\nReason:\n${result.reason}`);
  else console.log(`# Next Command\n\n${result.error}`);
  return result.ok ? 0 : 1;
}

export function runHandoffBundle(argv, context) {
  const json = hasFlag(argv, '--json');
  const [agentId, taskId] = getPositionals(argv, VALUED_FLAGS);
  if (!agentId || !taskId) {
    return printCommandError('Usage: handoff-bundle <agent-id> <task-id> [--json]', { json });
  }

  const cli = getFlagValue(argv, '--cli', 'npm run agents --');
  const privacy = getPrivacyOptions(context.config);
  const board = applyPromptPrivacy(context.board, privacy);
  const result = buildHandoffBundle(board, agentId, taskId, { cli });
  result.privacy = privacy;
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(result.bundle);
  else console.log(`# Handoff Bundle: ${taskId}\n\n${result.error}`);
  return result.ok ? 0 : 1;
}
