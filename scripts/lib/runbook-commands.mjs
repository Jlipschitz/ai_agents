import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { normalizePath } from './path-utils.mjs';

const RUNBOOKS_DIR = 'runbooks';
const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const BUILT_IN_RUNBOOKS = [
  {
    id: 'migration',
    title: 'Database migration',
    summary: 'Coordinate schema, migration, seed, and rollback work.',
    triggers: { keywords: ['migration', 'schema', 'sql', 'seed', 'rollback'], paths: ['migrations', 'db', 'database', 'schema'] },
    steps: [
      'Identify affected schema, data, and application paths.',
      'Define rollback and compatibility expectations before editing migrations.',
      'Run migration tests and record verification on the task.',
      'Update docs or app notes with operational gotchas.',
    ],
    checks: ['npm test'],
    docs: ['docs'],
    source: 'built-in',
  },
  {
    id: 'auth',
    title: 'Auth change',
    summary: 'Coordinate authentication, authorization, session, and policy changes.',
    triggers: { keywords: ['auth', 'login', 'session', 'oauth', 'permission', 'policy'], paths: ['auth', 'api/auth', 'middleware', 'server/auth'] },
    steps: [
      'Map user/session states and protected routes before changing behavior.',
      'Check API, middleware, storage, and UI callers for compatibility.',
      'Add or update negative-path verification for denied access.',
      'Record rollout or rollback notes for sensitive auth changes.',
    ],
    checks: ['npm test'],
    docs: ['docs/api'],
    source: 'built-in',
  },
  {
    id: 'release',
    title: 'Release',
    summary: 'Coordinate release readiness, verification, changelog, and handoff artifacts.',
    triggers: { keywords: ['release', 'deploy', 'version', 'changelog'], paths: ['package.json', 'CHANGELOG.md', 'docs/releases', '.github/workflows'] },
    steps: [
      'Run release checks for all candidate tasks.',
      'Generate or update changelog and PR/release handoff notes.',
      'Confirm build, test, and required review evidence.',
      'Record release artifacts and rollback notes.',
    ],
    checks: ['npm run agents:release:check', 'npm run agents:changelog'],
    docs: ['docs'],
    source: 'built-in',
  },
  {
    id: 'incident',
    title: 'Incident response',
    summary: 'Coordinate urgent incident ownership, shared resources, and resolution notes.',
    triggers: { keywords: ['incident', 'outage', 'hotfix', 'sev', 'urgent'], paths: ['coordination/incidents', 'server', 'api', 'infra'] },
    steps: [
      'Open or join an incident record before taking shared resources.',
      'Reserve affected resources and state the mitigation owner.',
      'Keep status updates short, timestamped, and task-linked.',
      'Close with resolution, verification, and follow-up tasks.',
    ],
    checks: ['npm run agents:doctor'],
    docs: ['docs'],
    source: 'built-in',
  },
  {
    id: 'visual-update',
    title: 'Visual update',
    summary: 'Coordinate UI, screenshot, layout, and visual regression work.',
    triggers: { keywords: ['visual', 'ui', 'layout', 'screenshot', 'responsive'], paths: ['app', 'src', 'components', 'features', 'assets', 'public'] },
    steps: [
      'Identify visual-impact paths and expected viewport coverage.',
      'Run visual checks before and after the change.',
      'Update screenshots or baselines only with explicit review.',
      'Attach artifacts or verification notes to the task.',
    ],
    checks: ['npm run visual:test'],
    docs: ['docs'],
    source: 'built-in',
  },
];

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getListFlag(argv, flag) {
  return splitList(getFlagValue(argv, flag, ''));
}

function getStepsFlag(argv) {
  const raw = getFlagValue(argv, '--steps', '');
  return String(raw)
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runbooksRoot(paths) {
  return path.join(paths.coordinationRoot, RUNBOOKS_DIR);
}

function runbookPath(paths, id) {
  return path.join(runbooksRoot(paths), `${id}.json`);
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { malformed: true, error: error.message };
  }
}

function normalizeRunbook(value, source, filePath = '') {
  const triggers = value?.triggers && typeof value.triggers === 'object' ? value.triggers : {};
  return {
    id: String(value?.id ?? '').trim(),
    title: String(value?.title ?? value?.id ?? '').trim(),
    summary: String(value?.summary ?? '').trim(),
    triggers: {
      keywords: splitList(Array.isArray(triggers.keywords) ? triggers.keywords.join(',') : triggers.keywords),
      paths: splitList(Array.isArray(triggers.paths) ? triggers.paths.join(',') : triggers.paths),
    },
    steps: Array.isArray(value?.steps) ? value.steps.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [],
    checks: Array.isArray(value?.checks) ? value.checks.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [],
    docs: Array.isArray(value?.docs) ? value.docs.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [],
    source,
    path: filePath || null,
  };
}

function validateRunbook(runbook) {
  const errors = [];
  if (!VALID_ID_PATTERN.test(runbook.id)) errors.push('id must use letters, numbers, dot, underscore, or dash and start with a letter or number');
  if (!runbook.title) errors.push('title is required');
  if (!runbook.steps.length) errors.push('at least one step is required');
  if (!runbook.triggers.keywords.length && !runbook.triggers.paths.length) errors.push('at least one trigger keyword or path is required');
  return errors;
}

function loadCustomRunbooks(paths) {
  const root = runbooksRoot(paths);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      const raw = readJsonSafe(filePath);
      if (raw?.malformed) {
        return { id: path.basename(entry.name, '.json'), title: path.basename(entry.name, '.json'), summary: '', triggers: { keywords: [], paths: [] }, steps: [], checks: [], docs: [], source: 'custom', path: filePath, errors: [raw.error] };
      }
      const runbook = normalizeRunbook(raw, 'custom', filePath);
      const errors = validateRunbook(runbook);
      return errors.length ? { ...runbook, errors } : runbook;
    });
}

function loadRunbooks(paths) {
  const byId = new Map();
  for (const runbook of BUILT_IN_RUNBOOKS.map((entry) => normalizeRunbook(entry, 'built-in'))) {
    byId.set(runbook.id, runbook);
  }
  for (const runbook of loadCustomRunbooks(paths)) {
    byId.set(runbook.id, runbook);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function taskText(task) {
  return [task?.id, task?.title, task?.summary, task?.description, task?.status, ...(Array.isArray(task?.relevantDocs) ? task.relevantDocs : [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function scoreRunbook(runbook, input) {
  const reasons = [];
  let score = 0;
  const text = input.text.toLowerCase();
  for (const keyword of runbook.triggers.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 3;
      reasons.push(`keyword:${keyword}`);
    }
  }
  for (const filePath of input.paths) {
    const matchingScope = runbook.triggers.paths.find((scope) => pathMatchesScope(filePath, scope));
    if (matchingScope) {
      score += 5;
      reasons.push(`path:${matchingScope}`);
    }
  }
  return { runbook, score, reasons: [...new Set(reasons)] };
}

function buildSuggestionInput(argv, board) {
  const taskId = getFlagValue(argv, '--task', '');
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const task = taskId ? tasks.find((entry) => entry.id === taskId) : null;
  const explicitPaths = getListFlag(argv, '--paths');
  const explicitSummary = getFlagValue(argv, '--summary', '');
  return {
    taskId: (task?.id ?? taskId) || null,
    paths: [...new Set([...explicitPaths, ...splitList(Array.isArray(task?.claimedPaths) ? task.claimedPaths.join(',') : '')])],
    text: [explicitSummary, taskText(task)].filter(Boolean).join(' '),
  };
}

function renderRunbook(runbook) {
  const lines = [`# ${runbook.title}`, `ID: ${runbook.id}`, `Source: ${runbook.source}`];
  if (runbook.summary) lines.push(`Summary: ${runbook.summary}`);
  if (runbook.errors?.length) lines.push(`Errors: ${runbook.errors.join('; ')}`);
  lines.push('');
  lines.push(`Trigger keywords: ${runbook.triggers.keywords.length ? runbook.triggers.keywords.join(', ') : 'none'}`);
  lines.push(`Trigger paths: ${runbook.triggers.paths.length ? runbook.triggers.paths.join(', ') : 'none'}`);
  lines.push('');
  lines.push('Steps:');
  lines.push(runbook.steps.length ? runbook.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '- none');
  if (runbook.checks.length) {
    lines.push('');
    lines.push('Checks:');
    lines.push(runbook.checks.map((check) => `- ${check}`).join('\n'));
  }
  if (runbook.docs.length) {
    lines.push('');
    lines.push('Docs:');
    lines.push(runbook.docs.map((doc) => `- ${doc}`).join('\n'));
  }
  return lines.join('\n');
}

function renderRunbookList(runbooks) {
  return ['# Runbooks', ...runbooks.map((runbook) => `- ${runbook.id} (${runbook.source}): ${runbook.title}${runbook.errors?.length ? ' [invalid]' : ''}`)].join('\n');
}

function renderSuggestions(suggestions) {
  const lines = ['# Suggested Runbooks'];
  if (!suggestions.length) {
    lines.push('- none');
    return lines.join('\n');
  }
  for (const suggestion of suggestions) {
    lines.push(`- ${suggestion.runbook.id}: ${suggestion.runbook.title} (score ${suggestion.score})`);
    if (suggestion.reasons.length) lines.push(`  reasons: ${suggestion.reasons.join(', ')}`);
  }
  return lines.join('\n');
}

function buildCreatedRunbook(argv) {
  const id = String(argv[1] ?? '').trim();
  const runbook = normalizeRunbook({
    id,
    title: getFlagValue(argv, '--title', id),
    summary: getFlagValue(argv, '--summary', ''),
    triggers: {
      keywords: getListFlag(argv, '--keywords'),
      paths: getListFlag(argv, '--paths'),
    },
    steps: getStepsFlag(argv),
    checks: getListFlag(argv, '--checks'),
    docs: getListFlag(argv, '--docs'),
  }, 'custom');
  return runbook;
}

function runList(argv, context) {
  const runbooks = loadRunbooks(context.paths);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify({ runbooks }, null, 2));
  else console.log(renderRunbookList(runbooks));
  return 0;
}

function runShow(argv, context) {
  const id = String(argv[1] ?? '').trim();
  const json = hasFlag(argv, '--json');
  if (!id) return printCommandError('Usage: runbooks show <id> [--json]', { json });
  const runbook = loadRunbooks(context.paths).find((entry) => entry.id === id);
  if (!runbook) return printCommandError(`Runbook not found: ${id}`, { json });
  if (json) console.log(JSON.stringify({ runbook }, null, 2));
  else console.log(renderRunbook(runbook));
  return runbook.errors?.length ? 1 : 0;
}

function runSuggest(argv, context) {
  const json = hasFlag(argv, '--json');
  const input = buildSuggestionInput(argv, context.board);
  const suggestions = loadRunbooks(context.paths)
    .filter((runbook) => !runbook.errors?.length)
    .map((runbook) => scoreRunbook(runbook, input))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.runbook.id.localeCompare(right.runbook.id));
  if (json) console.log(JSON.stringify({ input, suggestions }, null, 2));
  else console.log(renderSuggestions(suggestions));
  return 0;
}

function runCreate(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const runbook = buildCreatedRunbook(argv);
  const errors = validateRunbook(runbook);
  if (errors.length) return printCommandError(`Invalid runbook: ${errors.join('; ')}`, { json });
  const filePath = runbookPath(context.paths, runbook.id);
  const payload = { ...runbook };
  delete payload.source;
  delete payload.path;
  if (fs.existsSync(filePath) && !hasFlag(argv, '--force')) {
    return printCommandError(`Runbook already exists: ${runbook.id}. Pass --force to replace it.`, { json });
  }
  if (apply) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }
  const result = { applied: apply, path: filePath, runbook: { ...runbook, path: filePath } };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(apply ? `Wrote runbook ${runbook.id} to ${filePath}` : `Dry run: would write runbook ${runbook.id} to ${filePath}`);
  return 0;
}

export function runRunbooks(argv, context) {
  const command = argv[0] || 'list';
  if (command === 'list') return runList(argv, context);
  if (command === 'show') return runShow(argv, context);
  if (command === 'suggest') return runSuggest(argv, context);
  if (command === 'create') return runCreate(argv, context);
  return printCommandError('Usage: runbooks list|show <id>|suggest|create <id> [options]', { json: hasFlag(argv, '--json') });
}
