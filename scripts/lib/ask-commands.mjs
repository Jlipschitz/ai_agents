import { getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { ensureTaskMetadataDefaults, formatTaskDueAt, taskMetadataLabels, taskUrgencyScore } from './task-metadata.mjs';

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'review', 'waiting', 'handoff']);
const TERMINAL_STATUSES = new Set(['done', 'released']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePathLike(value) {
  return String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/g, '');
}

function pathsOverlap(left, right) {
  const a = normalizePathLike(left);
  const b = normalizePathLike(right);
  if (!a || !b) {
    return false;
  }
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
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

function taskSummary(task) {
  const owner = task.ownerId ? `owner ${task.ownerId}` : 'unowned';
  const title = task.title ? ` - ${task.title}` : '';
  const summary = task.summary ? ` | ${task.summary}` : '';
  const metadata = taskMetadataLabels(task, { includeDefaultPriority: true, includeDefaultSeverity: true }).join(', ');
  const metadataSuffix = metadata ? ` | ${metadata}` : '';
  return `${task.id}${title}: ${task.status}, ${owner}${metadataSuffix}${summary}`;
}

function boardTasks(board) {
  return array(board.tasks).map(normalizeTask);
}

function boardAgents(board) {
  return array(board.agents);
}

function extractAfter(question, patterns) {
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/[?!.]+$/g, '').trim();
    }
  }
  return '';
}

function findTaskByMention(tasks, question) {
  const lowered = question.toLowerCase();
  return tasks.find((task) => lowered.includes(String(task.id).toLowerCase())) ?? null;
}

function findOwnership(board, question) {
  const tasks = boardTasks(board);
  const target = extractAfter(question, [
    /\bwho\s+owns\s+(.+)$/i,
    /\bowner\s+of\s+(.+)$/i,
    /\bowns\s+(.+)$/i,
  ]);
  const mentionedTask = findTaskByMention(tasks, target || question);
  if (mentionedTask) {
    return {
      intent: 'ownership',
      items: [mentionedTask],
      answer: `${mentionedTask.id} is ${mentionedTask.ownerId ? `owned by ${mentionedTask.ownerId}` : 'unowned'} and is ${mentionedTask.status}.`,
    };
  }

  const activeOwners = tasks.filter((task) => ACTIVE_STATUSES.has(task.status) && task.claimedPaths.some((entry) => pathsOverlap(entry, target)));
  if (activeOwners.length) {
    return {
      intent: 'ownership',
      items: activeOwners,
      answer: activeOwners.map((task) => `${target} overlaps ${task.id} owned by ${task.ownerId ?? 'nobody'} (${task.claimedPaths.join(', ') || 'no paths'}).`).join('\n'),
    };
  }

  return {
    intent: 'ownership',
    items: [],
    answer: target ? `No active ownership was found for ${target}.` : 'Ask "who owns <path-or-task-id>" to check ownership.',
  };
}

function dependencySatisfied(tasks, dependencyId) {
  const dependency = tasks.find((task) => task.id === dependencyId);
  return dependency && TERMINAL_STATUSES.has(dependency.status);
}

function readyCandidates(board, agentId = '') {
  const tasks = boardTasks(board);
  return tasks
    .filter((task) => {
      if (task.ownerId) {
        return false;
      }
      if (task.status === 'handoff' || task.status === 'review') {
        return true;
      }
      if (task.status !== 'planned') {
        return false;
      }
      return task.dependencies.every((dependencyId) => dependencySatisfied(tasks, dependencyId));
    })
    .map((task) => {
      let score = 0;
      if (task.suggestedOwnerId && task.suggestedOwnerId === agentId) score += 10;
      if (task.status === 'handoff') score += 8;
      if (task.status === 'review') score += 6;
      if (task.status === 'planned') score += 4;
      if (!task.dependencies.length || task.dependencies.every((dependencyId) => dependencySatisfied(tasks, dependencyId))) score += 5;
      score += taskUrgencyScore(task);
      return { task, score };
    })
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      return scoreDelta || left.task.id.localeCompare(right.task.id);
    })
    .map((entry) => entry.task);
}

function extractAgentId(question) {
  const match = question.match(/\b(agent-[\w-]+)\b/i);
  return match?.[1] ?? '';
}

function answerNext(board, question) {
  const tasks = boardTasks(board);
  const agents = boardAgents(board);
  const agentId = extractAgentId(question);
  const agent = agentId ? agents.find((entry) => entry?.id === agentId) : null;

  if (agent?.taskId) {
    const assignedTask = tasks.find((task) => task.id === agent.taskId);
    return {
      intent: 'next',
      items: assignedTask ? [assignedTask] : [],
      answer: assignedTask
        ? `${agentId} is already assigned to ${taskSummary(assignedTask)}.`
        : `${agentId} is assigned to ${agent.taskId}, but that task is missing from the board.`,
    };
  }

  const candidates = readyCandidates(board, agentId);
  if (!candidates.length) {
    return {
      intent: 'next',
      items: [],
      answer: agentId ? `No ready task was found for ${agentId}.` : 'No ready unowned task was found.',
    };
  }

  const [best] = candidates;
  return {
    intent: 'next',
    items: candidates.slice(0, 5),
    answer: `${agentId || 'Next agent'} can take ${taskSummary(best)}${best.claimedPaths.length ? ` Paths: ${best.claimedPaths.join(', ')}.` : ''}`,
  };
}

function answerStatus(board, status) {
  const tasks = boardTasks(board).filter((task) => task.status === status);
  return {
    intent: status,
    items: tasks,
    answer: tasks.length ? tasks.map(taskSummary).join('\n') : `No ${status} tasks found.`,
  };
}

function answerStale(board) {
  const tasks = boardTasks(board).filter((task) => {
    if (!ACTIVE_STATUSES.has(task.status)) return false;
    const updatedAt = Date.parse(task.updatedAt ?? task.createdAt ?? '');
    if (!Number.isFinite(updatedAt)) return false;
    return Date.now() - updatedAt > 6 * 60 * 60 * 1000;
  });
  return {
    intent: 'stale',
    items: tasks,
    answer: tasks.length ? tasks.map(taskSummary).join('\n') : 'No stale active work found.',
  };
}

function answerTask(board, question) {
  const tasks = boardTasks(board);
  const task = findTaskByMention(tasks, question);
  if (!task) {
    return null;
  }
  const dependencies = task.dependencies.length ? ` Dependencies: ${task.dependencies.join(', ')}.` : '';
  const waiting = task.waitingOn.length ? ` Waiting on: ${task.waitingOn.join(', ')}.` : '';
  const paths = task.claimedPaths.length ? ` Paths: ${task.claimedPaths.join(', ')}.` : '';
  const due = ` Due: ${formatTaskDueAt(task.dueAt)}.`;
  return {
    intent: 'task',
    items: [task],
    answer: `${taskSummary(task)}${paths}${dependencies}${waiting}${due}`,
  };
}

function answerSummary(board) {
  const tasks = boardTasks(board);
  const counts = tasks.reduce((map, task) => {
    map[task.status] = (map[task.status] ?? 0) + 1;
    return map;
  }, {});
  const ordered = ['planned', 'active', 'blocked', 'waiting', 'review', 'handoff', 'done', 'released']
    .map((status) => `${status}: ${counts[status] ?? 0}`)
    .join(', ');
  return {
    intent: 'summary',
    items: [],
    answer: `Board summary: ${ordered}.`,
  };
}

export function answerBoardQuestion(board, rawQuestion) {
  const question = String(rawQuestion ?? '').trim();
  const lowered = question.toLowerCase();
  if (!question) {
    return {
      ok: false,
      question,
      intent: 'unknown',
      answer: 'Usage: ask "<question>"',
      items: [],
      suggestions: supportedQuestions(),
    };
  }

  let result;
  if (/\b(who owns|owner of|owns)\b/i.test(question)) result = findOwnership(board, question);
  else if (/\b(next|pick|do next|work on)\b/i.test(question)) result = answerNext(board, question);
  else if (/\b(blocked|blocker|stuck)\b/i.test(question)) result = answerStatus(board, 'blocked');
  else if (/\b(waiting|wait)\b/i.test(question)) result = answerStatus(board, 'waiting');
  else if (/\b(review|verify)\b/i.test(question)) result = answerStatus(board, 'review');
  else if (/\b(handoff|handover)\b/i.test(question)) result = answerStatus(board, 'handoff');
  else if (/\bstale\b/i.test(question)) result = answerStale(board);
  else result = answerTask(board, question) ?? answerSummary(board);

  return {
    ok: true,
    question,
    intent: result.intent,
    answer: result.answer,
    items: result.items.map((task) => ({
      id: task.id,
      title: task.title ?? '',
      status: task.status ?? 'unknown',
      ownerId: task.ownerId ?? null,
      claimedPaths: task.claimedPaths,
      summary: task.summary ?? '',
      priority: task.priority ?? 'normal',
      dueAt: task.dueAt ?? null,
      severity: task.severity ?? 'none',
    })),
    suggestions: supportedQuestions(),
    matchedFallback: result.intent === 'summary' && !/\b(summary|status|board)\b/i.test(lowered),
  };
}

function supportedQuestions() {
  return [
    'what is blocked?',
    'what is waiting?',
    'what needs review?',
    'who owns src/path?',
    'who owns task-id?',
    'what can agent-2 do next?',
    'what is stale?',
  ];
}

export function runAskCommand(argv, context) {
  const json = hasFlag(argv, '--json');
  const positionals = getPositionals(argv);
  const question = positionals.join(' ').trim();
  if (!question) {
    return printCommandError('Usage: ask "<question>" [--json]', { json });
  }

  const result = answerBoardQuestion(context.board, question);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.answer);
    if (result.matchedFallback) {
      console.log(`Try: ${result.suggestions.join(' | ')}`);
    }
  }
  return result.ok ? 0 : 1;
}
