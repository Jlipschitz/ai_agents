import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { fileTimestamp, nowIso, writeJson } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const CONFIG_TEMPLATES = {
  'generic-node': {
    description: 'General Node.js repository defaults.',
    patch: {
      paths: { sharedRisk: ['package.json', 'src', 'lib'] },
      checks: { test: { command: 'npm test', timeoutMs: 120000, artifactRoots: ['artifacts'], requiredForPaths: ['src', 'lib', 'test', 'tests'], requireArtifacts: false } },
    },
  },
  react: {
    description: 'React or Next-style frontend defaults with visual checks.',
    patch: {
      paths: { sharedRisk: ['package.json', 'src', 'app', 'components'], visualImpact: ['app', 'src', 'components', 'pages'], visualSuite: ['tests/visual', 'playwright-report', 'test-results'] },
      verification: { visualRequiredChecks: ['visual:test'], visualSuiteUpdateChecks: ['visual:update'] },
      checks: { 'visual:test': { command: 'npm run visual:test', timeoutMs: 120000, artifactRoots: ['artifacts', 'playwright-report', 'test-results'], requiredForPaths: ['app', 'src', 'components', 'pages'], requireArtifacts: true } },
    },
  },
  expo: {
    description: 'Expo/mobile app defaults.',
    patch: {
      paths: { sharedRisk: ['app.json', 'app.config.js', 'app.config.ts', 'src', 'app'], visualImpact: ['app', 'src', 'components', 'assets'], visualImpactFiles: ['app.json', 'app.config.js', 'app.config.ts'] },
      verification: { visualRequiredChecks: ['visual:test'] },
      domainRules: [{ name: 'mobile', keywords: ['expo', 'mobile', 'ios', 'android', 'native'], scopes: { product: ['app', 'src', 'components'], data: ['lib', 'hooks'], verify: ['tests'], docs: ['README.md', 'docs'] } }],
    },
  },
  supabase: {
    description: 'Supabase/backend data defaults.',
    patch: {
      paths: { sharedRisk: ['supabase', 'migrations', 'database', 'db', 'api', 'server', 'lib'] },
      checks: { test: { command: 'npm test', timeoutMs: 120000, artifactRoots: ['artifacts'], requiredForPaths: ['api', 'server', 'lib', 'supabase', 'migrations', 'database', 'db'], requireArtifacts: false } },
      domainRules: [{ name: 'backend', keywords: ['api', 'server', 'backend', 'database', 'db', 'schema', 'migration', 'supabase', 'auth'], scopes: { product: ['app', 'src'], data: ['api', 'server', 'lib', 'supabase', 'migrations', 'database', 'db'], verify: ['tests'], docs: ['README.md', 'docs'] } }],
    },
  },
  'docs-only': {
    description: 'Documentation-focused repository defaults.',
    patch: {
      docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md' },
      paths: { sharedRisk: ['README.md', 'docs'], visualImpact: [], visualSuite: [] },
      verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
    },
  },
};

const TASK_TEMPLATES = {
  'ui-change': { summary: 'Implement UI change and verify visual behavior.', claimedPaths: ['app', 'src', 'components'], verification: ['visual:test'], effort: 'medium' },
  migration: { summary: 'Implement data/schema migration with rollback notes.', claimedPaths: ['migrations', 'db', 'database'], verification: ['test'], effort: 'medium' },
  'api-endpoint': { summary: 'Implement API endpoint and request/response verification.', claimedPaths: ['api', 'server', 'lib'], verification: ['test'], effort: 'medium' },
  'test-only': { summary: 'Add or update tests without production behavior changes.', claimedPaths: ['tests'], verification: ['test'], effort: 'small' },
  'docs-only': { summary: 'Update documentation and examples.', claimedPaths: ['README.md', 'docs'], verification: [], effort: 'small' },
  refactor: { summary: 'Refactor implementation while preserving behavior.', claimedPaths: ['src', 'lib'], verification: ['test'], effort: 'medium' },
};

function mergeUnique(left, right) {
  return [...new Set([...(Array.isArray(left) ? left : []), ...right])];
}

function mergeTemplateValue(current, patch) {
  if (Array.isArray(patch)) return mergeUnique(current, patch);
  if (patch && typeof patch === 'object') {
    const target = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
    for (const [key, value] of Object.entries(patch)) target[key] = mergeTemplateValue(target[key], value);
    return target;
  }
  return current === undefined ? patch : current;
}

function diffValues(before, after, prefix = '') {
  const changes = [];
  const keys = new Set([...Object.keys(before && typeof before === 'object' ? before : {}), ...Object.keys(after && typeof after === 'object' ? after : {})]);
  for (const key of [...keys].sort()) {
    const pathLabel = prefix ? `${prefix}.${key}` : key;
    if (before?.[key] && after?.[key] && typeof before[key] === 'object' && typeof after[key] === 'object' && !Array.isArray(before[key]) && !Array.isArray(after[key])) {
      changes.push(...diffValues(before[key], after[key], pathLabel));
    } else if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      changes.push({ path: pathLabel, before: before?.[key] ?? null, after: after?.[key] ?? null });
    }
  }
  return changes;
}

function snapshotFile(filePath, snapshotsRoot, label) {
  if (!fs.existsSync(filePath)) return null;
  fs.mkdirSync(snapshotsRoot, { recursive: true });
  const snapshotPath = path.join(snapshotsRoot, `${label}-${fileTimestamp()}.json`);
  fs.copyFileSync(filePath, snapshotPath);
  return snapshotPath;
}

function renderList() {
  return [
    '# Templates',
    '',
    'Config templates:',
    ...Object.entries(CONFIG_TEMPLATES).map(([name, template]) => `- ${name}: ${template.description}`),
    '',
    'Task templates:',
    ...Object.entries(TASK_TEMPLATES).map(([name, template]) => `- ${name}: ${template.summary}`),
  ].join('\n');
}

function createTaskFromTemplate(templateName, argv) {
  const template = TASK_TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown task template "${templateName}".`);
  const taskId = getFlagValue(argv, '--id', '');
  if (!taskId) throw new Error('Usage: templates create-task <template> --id <task-id> [--summary <text>] [--paths <path[,path...]>] [--apply]');
  const claimedPaths = getFlagValue(argv, '--paths', '')
    .split(',')
    .map((entry) => normalizePath(entry))
    .filter(Boolean);
  const timestamp = nowIso();
  return {
    id: taskId,
    status: 'planned',
    ownerId: null,
    suggestedOwnerId: getFlagValue(argv, '--owner', '') || null,
    summary: getFlagValue(argv, '--summary', template.summary),
    claimedPaths: claimedPaths.length ? claimedPaths : template.claimedPaths,
    dependencies: [],
    verification: template.verification,
    verificationLog: [],
    notes: [],
    rationale: `Created from task template "${templateName}".`,
    effort: template.effort,
    waitingOn: [],
    relevantDocs: [],
    docsReviewedAt: null,
    docsReviewedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function runTemplates(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const positionals = getPositionals(argv, new Set(['--id', '--summary', '--paths', '--owner']));
  const [subcommand = 'list', name] = positionals;

  if (subcommand === 'list') {
    const result = { configTemplates: CONFIG_TEMPLATES, taskTemplates: TASK_TEMPLATES };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(renderList());
    return 0;
  }

  if (subcommand === 'show') {
    const template = CONFIG_TEMPLATES[name] ? { kind: 'config', name, ...CONFIG_TEMPLATES[name] } : TASK_TEMPLATES[name] ? { kind: 'task', name, ...TASK_TEMPLATES[name] } : null;
    if (!template) throw new Error(`Unknown template "${name}".`);
    if (json) console.log(JSON.stringify(template, null, 2));
    else console.log(`${template.name}\n${template.description ?? template.summary}`);
    return 0;
  }

  if (subcommand === 'apply') {
    const template = CONFIG_TEMPLATES[name];
    if (!template) throw new Error(`Unknown config template "${name}".`);
    const nextConfig = mergeTemplateValue(context.config, template.patch);
    const changes = diffValues(context.config, nextConfig);
    const result = { ok: true, applied: false, template: name, changes, snapshotPath: null };
    if (apply && changes.length) {
      result.snapshotPath = snapshotFile(context.configPath, context.paths.snapshotsRoot, `config-before-template-${name}`);
      writeJson(context.configPath, nextConfig);
      result.applied = true;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${apply ? 'Applied' : 'Dry run for'} config template ${name}.\n${changes.length ? changes.map((entry) => `- ${entry.path}`).join('\n') : '- no changes needed'}`);
    return 0;
  }

  if (subcommand === 'create-task') {
    const task = createTaskFromTemplate(name, argv);
    const board = context.board && typeof context.board === 'object' ? context.board : { tasks: [] };
    board.tasks = Array.isArray(board.tasks) ? board.tasks : [];
    const exists = board.tasks.some((entry) => entry.id === task.id);
    const result = { ok: !exists, applied: false, task, error: exists ? `Task ${task.id} already exists.` : null, snapshotPath: null };
    if (!exists && apply) {
      result.snapshotPath = snapshotFile(context.paths.boardPath, context.paths.snapshotsRoot, `board-before-template-task-${task.id}`);
      board.tasks.push(task);
      writeJson(context.paths.boardPath, board);
      result.applied = true;
    }
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(exists ? result.error : `${apply ? 'Created' : 'Dry run for'} task ${task.id} from template ${name}.`);
    return result.ok ? 0 : 1;
  }

  throw new Error('Usage: templates list|show <name>|apply <config-template>|create-task <task-template> [options]');
}
