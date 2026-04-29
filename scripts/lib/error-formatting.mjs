export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.code = options.code;
    this.hint = options.hint;
    this.exitCode = options.exitCode;
  }
}

export function wantsJson(argv = process.argv.slice(2)) {
  return argv.includes('--json');
}

export function isVerbose(argv = process.argv.slice(2), env = process.env) {
  return argv.includes('--verbose') || env.AGENT_COORDINATION_VERBOSE === '1';
}

export function inferErrorCode(message = '') {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('usage:') || normalized.includes('unknown command') || normalized.includes('unknown argument') || normalized.includes('invalid option')) return 'usage_error';
  if (normalized.includes('unknown template') || normalized.includes('not found') || normalized.includes('does not exist') || normalized.includes('config not found') || normalized.includes('snapshot not found')) return 'not_found';
  if (normalized.includes('not valid json') || normalized.includes('malformed') || normalized.includes('failed to parse')) return 'parse_error';
  if (normalized.includes('config invalid') || normalized.includes('validation')) return 'validation_error';
  if (normalized.includes('git')) return 'git_error';
  return 'command_error';
}

export function inferHint(message = '') {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('usage:') || normalized.includes('unknown command') || normalized.includes('unknown argument') || normalized.includes('invalid option')) return 'Run with --help for command usage.';
  if (normalized.includes('config')) return 'Run validate --json or explain-config for configuration details.';
  if (normalized.includes('board') || normalized.includes('snapshot')) return 'Run inspect-board, repair-board, or rollback-state for state details.';
  if (normalized.includes('lock')) return 'Run lock-status or watch-diagnose for runtime lock details.';
  if (normalized.includes('template')) return 'Run templates list to see available templates.';
  return '';
}

export function formatErrorPayload(error, options = {}) {
  const message = error?.message || String(error || 'Unknown error');
  const code = error?.code || inferErrorCode(message);
  const hint = error?.hint ?? inferHint(message);
  const payload = { ok: false, error: message, code };
  if (hint) payload.hint = hint;
  if (options.verbose && error?.stack) payload.stack = error.stack;
  return payload;
}

export function printCliError(error, options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const verbose = options.verbose ?? isVerbose(argv);
  const payload = formatErrorPayload(error, { verbose });

  if (options.json ?? wantsJson(argv)) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.error(`error: ${payload.error}`);
  if (payload.hint) console.error(`hint: ${payload.hint}`);
  if (verbose && payload.stack) console.error(payload.stack);
}

export function printCommandError(error, options = {}) {
  const normalizedError = typeof error === 'string' ? new CliError(error, options) : error;
  printCliError(normalizedError, options);
  return exitCodeForError(normalizedError);
}

export function exitCodeForError(error) {
  const exitCode = Number.parseInt(String(error?.exitCode ?? ''), 10);
  return Number.isFinite(exitCode) && exitCode > 0 ? exitCode : 1;
}
