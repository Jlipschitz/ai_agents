const PRIVACY_MODES = new Set(['standard', 'redacted', 'local-only']);

export function getPrivacyOptions(config = {}, env = process.env) {
  const configured = config?.privacy && typeof config.privacy === 'object' ? config.privacy : {};
  const envMode = env.AI_AGENTS_PRIVACY_MODE;
  const mode = PRIVACY_MODES.has(envMode) ? envMode : (PRIVACY_MODES.has(configured.mode) ? configured.mode : 'standard');
  const offline = env.AI_AGENTS_OFFLINE === '1' || configured.offline === true || mode === 'local-only';
  return {
    mode,
    offline,
    redacted: mode === 'redacted' || mode === 'local-only',
  };
}

function redactText(value) {
  if (typeof value !== 'string' || value.trim() === '') return value;
  return '[redacted]';
}

function redactArray(values) {
  return Array.isArray(values) && values.length ? ['[redacted]'] : values;
}

function redactTask(task) {
  if (!task || typeof task !== 'object') return task;
  return {
    ...task,
    title: redactText(task.title),
    summary: redactText(task.summary),
    rationale: redactText(task.rationale),
    claimedPaths: redactArray(task.claimedPaths),
    relevantDocs: redactArray(task.relevantDocs),
    notes: Array.isArray(task.notes)
      ? task.notes.map((note) => ({ ...note, body: redactText(note?.body) }))
      : task.notes,
    verificationLog: Array.isArray(task.verificationLog)
      ? task.verificationLog.map((entry) => ({ ...entry, details: redactText(entry?.details), artifacts: redactArray(entry?.artifacts) }))
      : task.verificationLog,
  };
}

export function applyPromptPrivacy(board, privacy) {
  if (!privacy?.redacted || !board || typeof board !== 'object') return board;
  return {
    ...board,
    tasks: Array.isArray(board.tasks) ? board.tasks.map(redactTask) : board.tasks,
    approvals: Array.isArray(board.approvals)
      ? board.approvals.map((approval) => ({ ...approval, summary: redactText(approval?.summary) }))
      : board.approvals,
  };
}
