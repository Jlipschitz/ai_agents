export const DEFAULT_TASK_PRIORITY = 'normal';
export const DEFAULT_TASK_SEVERITY = 'none';
export const TASK_PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];
export const TASK_SEVERITY_LEVELS = ['none', 'low', 'medium', 'high', 'critical'];

const CLEAR_DUE_VALUES = new Set(['none', 'null', 'clear', 'unset']);
const PRIORITY_SCORES = new Map([
  ['low', 0],
  ['normal', 1],
  ['high', 3],
  ['urgent', 5],
]);
const SEVERITY_SCORES = new Map([
  ['none', 0],
  ['low', 0],
  ['medium', 1],
  ['high', 2],
  ['critical', 3],
]);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function normalizeEnum(value, validValues, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!validValues.includes(normalized)) {
    throw new Error(`Invalid ${label} "${value}". Expected one of: ${validValues.join(', ')}.`);
  }
  return normalized;
}

export function normalizeTaskPriority(value) {
  return normalizeEnum(value, TASK_PRIORITY_LEVELS, 'task priority');
}

export function normalizeTaskSeverity(value) {
  return normalizeEnum(value, TASK_SEVERITY_LEVELS, 'task severity');
}

export function normalizeTaskDueAt(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new Error('Task due date cannot be empty. Use "none" to clear it.');
  }
  if (CLEAR_DUE_VALUES.has(raw.toLowerCase())) {
    return null;
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid task due date "${value}". Use an ISO timestamp, YYYY-MM-DD, or "none".`);
  }
  return parsed.toISOString();
}

export function isValidTaskPriority(value) {
  return TASK_PRIORITY_LEVELS.includes(String(value ?? '').trim().toLowerCase());
}

export function isValidTaskSeverity(value) {
  return TASK_SEVERITY_LEVELS.includes(String(value ?? '').trim().toLowerCase());
}

export function isValidTaskDueAt(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

export function ensureTaskMetadataDefaults(task, changes = null) {
  if (!task || typeof task !== 'object') return task;
  if (!own(task, 'priority')) {
    task.priority = DEFAULT_TASK_PRIORITY;
    changes?.push(`initialized ${task.id}.priority`);
  }
  if (!own(task, 'severity')) {
    task.severity = DEFAULT_TASK_SEVERITY;
    changes?.push(`initialized ${task.id}.severity`);
  }
  if (!own(task, 'dueAt')) {
    task.dueAt = null;
    changes?.push(`initialized ${task.id}.dueAt`);
  }
  return task;
}

export function taskMetadataFromOptions(options = {}, { includeDefaults = false } = {}) {
  const metadata = {};
  if (includeDefaults || own(options, 'priority')) {
    metadata.priority = own(options, 'priority') ? normalizeTaskPriority(options.priority) : DEFAULT_TASK_PRIORITY;
  }
  if (includeDefaults || own(options, 'severity')) {
    metadata.severity = own(options, 'severity') ? normalizeTaskSeverity(options.severity) : DEFAULT_TASK_SEVERITY;
  }
  const dueKey = own(options, 'due-at') ? 'due-at' : own(options, 'due') ? 'due' : null;
  if (includeDefaults || dueKey) {
    metadata.dueAt = dueKey ? normalizeTaskDueAt(options[dueKey]) : null;
  }
  return metadata;
}

export function taskMetadataFromArgv(argv = [], { getFlagValue, hasFlag, includeDefaults = false } = {}) {
  const options = {};
  if (hasFlag(argv, '--priority')) options.priority = getFlagValue(argv, '--priority');
  if (hasFlag(argv, '--severity')) options.severity = getFlagValue(argv, '--severity');
  if (hasFlag(argv, '--due-at')) options['due-at'] = getFlagValue(argv, '--due-at');
  else if (hasFlag(argv, '--due')) options.due = getFlagValue(argv, '--due');
  return taskMetadataFromOptions(options, { includeDefaults });
}

export function hasTaskMetadataOptions(options = {}) {
  return own(options, 'priority') || own(options, 'severity') || own(options, 'due-at') || own(options, 'due');
}

export function applyTaskMetadata(task, metadata = {}) {
  ensureTaskMetadataDefaults(task);
  const changes = [];
  for (const key of ['priority', 'severity', 'dueAt']) {
    if (!own(metadata, key) || task[key] === metadata[key]) continue;
    changes.push({ field: key, before: task[key] ?? null, after: metadata[key] ?? null });
    task[key] = metadata[key];
  }
  return changes;
}

export function formatTaskDueAt(dueAt) {
  if (!dueAt) return 'none';
  const text = String(dueAt);
  return text.endsWith('T00:00:00.000Z') ? text.slice(0, 10) : text;
}

export function formatTaskMetadataValue(field, value) {
  return field === 'dueAt' ? formatTaskDueAt(value) : String(value ?? 'none');
}

export function formatTaskMetadataChanges(changes) {
  return changes
    .map((change) => `${change.field}: ${formatTaskMetadataValue(change.field, change.before)} -> ${formatTaskMetadataValue(change.field, change.after)}`)
    .join(', ');
}

export function taskMetadataLabels(task, { includeDefaultPriority = false, includeDefaultSeverity = false } = {}) {
  ensureTaskMetadataDefaults(task);
  const labels = [];
  if (includeDefaultPriority || task.priority !== DEFAULT_TASK_PRIORITY) labels.push(`priority ${task.priority}`);
  if (task.dueAt) labels.push(`due ${formatTaskDueAt(task.dueAt)}`);
  if (includeDefaultSeverity || task.severity !== DEFAULT_TASK_SEVERITY) labels.push(`severity ${task.severity}`);
  return labels;
}

export function taskUrgencyScore(task, referenceMs = Date.now()) {
  ensureTaskMetadataDefaults(task);
  let score = (PRIORITY_SCORES.get(task.priority) ?? PRIORITY_SCORES.get(DEFAULT_TASK_PRIORITY)) * 2;
  score += SEVERITY_SCORES.get(task.severity) ?? 0;

  if (task.dueAt) {
    const dueMs = Date.parse(task.dueAt);
    if (Number.isFinite(dueMs)) {
      const hoursUntilDue = (dueMs - referenceMs) / (1000 * 60 * 60);
      if (hoursUntilDue < 0) score += 8;
      else if (hoursUntilDue <= 24) score += 5;
      else if (hoursUntilDue <= 72) score += 3;
      else if (hoursUntilDue <= 168) score += 1;
    }
  }

  return score;
}
