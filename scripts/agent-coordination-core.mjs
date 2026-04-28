import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = process.cwd();
const COORDINATION_ROOT_OVERRIDE = String(process.env.AGENT_COORDINATION_ROOT ?? '').trim();
const COORDINATION_DIR_OVERRIDE = String(process.env.AGENT_COORDINATION_DIR ?? '').trim();
const COORDINATION_ROOT = COORDINATION_ROOT_OVERRIDE
  ? path.isAbsolute(COORDINATION_ROOT_OVERRIDE)
    ? COORDINATION_ROOT_OVERRIDE
    : path.resolve(ROOT, COORDINATION_ROOT_OVERRIDE)
  : path.join(ROOT, COORDINATION_DIR_OVERRIDE || 'coordination');
const COORDINATION_LABEL = path.relative(ROOT, COORDINATION_ROOT).replaceAll('\\', '/') || '.';
const COORDINATION_README_PATH = COORDINATION_LABEL === '.' ? 'README.md' : `${COORDINATION_LABEL}/README.md`;
const CLI_ENTRYPOINT = resolveCliEntrypoint();
const COORDINATOR_SCRIPT_PATH = resolveRepoPath(
  process.env.AGENT_COORDINATION_SCRIPT,
  'scripts/agent-coordination.mjs'
);
const WATCH_LOOP_SCRIPT_PATH = resolveRepoPath(
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT,
  'scripts/agent-watch-loop.mjs'
);
const TASKS_ROOT = path.join(COORDINATION_ROOT, 'tasks');
const RUNTIME_ROOT = path.join(COORDINATION_ROOT, 'runtime');
const BOARD_PATH = path.join(COORDINATION_ROOT, 'board.json');
const JOURNAL_PATH = path.join(COORDINATION_ROOT, 'journal.md');
const MESSAGES_PATH = path.join(COORDINATION_ROOT, 'messages.ndjson');
const LOCK_PATH = path.join(RUNTIME_ROOT, 'state.lock.json');
const WATCHER_STATUS_PATH = path.join(RUNTIME_ROOT, 'watcher.status.json');
const AGENT_HEARTBEATS_ROOT = path.join(RUNTIME_ROOT, 'agent-heartbeats');
const AGENT_CONFIG_PATH = resolveAgentConfigPath();
const AGENT_CONFIG = loadAgentCoordinationConfig(AGENT_CONFIG_PATH);
const RAW_LOCK_WAIT_TIMEOUT_MS = Number.parseInt(String(process.env.AGENT_COORDINATION_LOCK_WAIT_MS ?? ''), 10);
const LOCK_WAIT_TIMEOUT_MS = Number.isFinite(RAW_LOCK_WAIT_TIMEOUT_MS) && RAW_LOCK_WAIT_TIMEOUT_MS >= 1000 ? RAW_LOCK_WAIT_TIMEOUT_MS : 60000;
const RAW_LOCK_STALE_AFTER_MS = Number.parseInt(String(process.env.AGENT_COORDINATION_LOCK_STALE_MS ?? ''), 10);
const LOCK_STALE_AFTER_MS = Number.isFinite(RAW_LOCK_STALE_AFTER_MS) && RAW_LOCK_STALE_AFTER_MS >= 1000
  ? RAW_LOCK_STALE_AFTER_MS
  : Math.max(LOCK_WAIT_TIMEOUT_MS * 2, 300000);
const LOCK_POLL_INTERVAL_MS = 125;
const LOCK_DIAGNOSTIC_INTERVAL_MS = 5000;
const WATCH_INTERVAL_MS = 30000;
const AGENT_HEARTBEAT_INTERVAL_MS = 30000;
const MIN_AGENT_HEARTBEAT_INTERVAL_MS = 5000;
const AGENT_HEARTBEAT_TTL_MS = 90000;
const STALE_TASK_HOURS = 6;
const STALE_INCIDENT_HOURS = 2;
const RESOURCE_STALE_HOURS = 2;
const ASSIST_MESSAGE_WINDOW_HOURS = 2;
const PLANNED_TASK_STATUS = 'planned';
const ACTIVE_TASK_STATUSES = new Set(['active', 'blocked', 'review', 'waiting']);
const TERMINAL_TASK_STATUSES = new Set(['done', 'released']);
const VALID_TASK_STATUSES = new Set([PLANNED_TASK_STATUS, ...ACTIVE_TASK_STATUSES, 'handoff', ...TERMINAL_TASK_STATUSES]);
const VALID_ACCESS_STATUSES = new Set(['pending', 'granted', 'denied', 'completed']);
const VALID_INCIDENT_STATUSES = new Set(['open', 'closed', 'abandoned']);
const DOC_REVIEW_REQUIRED_STATUSES = new Set(['active', 'blocked', 'review', 'waiting']);
const TERMINAL_ID = detectTerminalId();
const ALWAYS_READ_ONLY_COMMANDS = new Set(['help', 'status', 'pick', 'inbox', 'validate', 'doctor', 'watch-status', 'heartbeat-status']);
const AUTO_HEAL_EXCLUDED_COMMANDS = new Set([
  'help',
  'init',
  'recover',
  'watch',
  'watch-tick',
  'watch-start',
  'watch-stop',
  'watch-status',
  'heartbeat',
  'heartbeat-start',
  'heartbeat-stop',
  'heartbeat-status',
  'doctor',
]);
const DEFAULT_AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
const DEFAULT_APP_NOTE_CATEGORIES = ['error', 'inconsistency', 'change', 'gotcha', 'decision', 'verification', 'setup'];
const DEFAULT_DOMAIN_RULES = [
  {
    name: 'app',
    keywords: ['app', 'ui', 'screen', 'page', 'component', 'frontend', 'feature'],
    scopes: {
      product: ['app', 'src', 'components', 'features'],
      data: ['lib', 'src', 'hooks', 'store', 'types'],
      verify: ['tests'],
      docs: ['README.md', 'docs'],
    },
  },
  {
    name: 'backend',
    keywords: ['api', 'server', 'backend', 'database', 'db', 'schema', 'migration', 'auth'],
    scopes: {
      product: ['app', 'src'],
      data: ['api', 'server', 'lib', 'db', 'migrations', 'types'],
      verify: ['tests'],
      docs: ['README.md', 'docs'],
    },
  },
  {
    name: 'docs',
    keywords: ['doc', 'docs', 'documentation', 'readme'],
    scopes: {
      product: [],
      data: [],
      verify: [],
      docs: ['README.md', 'docs'],
    },
  },
];
const PROJECT_NAME = normalizeConfigString(AGENT_CONFIG.projectName, path.basename(ROOT));
const AGENT_IDS = normalizeConfigStringArray(AGENT_CONFIG.agentIds, DEFAULT_AGENT_IDS);
const DOCS_ROOTS = normalizeConfigPathArray(AGENT_CONFIG.docs?.roots, ['docs']);
const API_DOC_PATH_PREFIXES = normalizeConfigPathArray(AGENT_CONFIG.docs?.apiPrefixes, ['docs/api']);
const APP_AGENT_NOTES_DOC = normalizeConfigPath(AGENT_CONFIG.docs?.appNotes ?? AGENT_CONFIG.appAgentNotesDoc ?? 'docs/ai-agent-app-notes.md');
const VISUAL_WORKFLOW_DOC = normalizeConfigPath(AGENT_CONFIG.docs?.visualWorkflow ?? AGENT_CONFIG.visualWorkflowDoc ?? 'docs/visual-workflow.md');
const SHARED_RISK_PATHS = normalizeConfigPathArray(AGENT_CONFIG.paths?.sharedRisk ?? AGENT_CONFIG.sharedRiskPaths, [
  'components/ui',
  'components/common',
  'components/layout',
  'components/navigation',
  'hooks',
  'lib/api',
  'store',
  'types',
]);
const VISUAL_SUITE_PATHS = normalizeConfigPathArray(AGENT_CONFIG.paths?.visualSuite ?? AGENT_CONFIG.visualSuitePaths, [
  'app/visual',
  'tests/visual',
  'lib/visual',
]);
const VISUAL_SUITE_DEFAULT_PATHS = normalizeConfigPathArray(AGENT_CONFIG.paths?.visualSuiteDefault ?? AGENT_CONFIG.visualSuiteDefaultPaths, [
  'app/visual',
  'tests/visual',
  'lib/visual/fixtures.tsx',
]);
const VISUAL_IMPACT_PATHS = normalizeConfigPathArray(AGENT_CONFIG.paths?.visualImpact ?? AGENT_CONFIG.visualImpactPaths, [
  'app',
  'components',
  'features',
  'assets',
  'src',
]);
const VISUAL_IMPACT_FILES = normalizeConfigPathArray(AGENT_CONFIG.paths?.visualImpactFiles ?? AGENT_CONFIG.visualImpactFiles, [
  'app.json',
  'app.config.js',
  'app.config.ts',
  'global.css',
  'tailwind.config.js',
  'tailwind.config.ts',
]);
const VISUAL_REQUIRED_CHECKS = normalizeConfigStringArray(AGENT_CONFIG.verification?.visualRequiredChecks, ['visual']);
const VISUAL_SUITE_UPDATE_CHECKS = normalizeConfigStringArray(AGENT_CONFIG.verification?.visualSuiteUpdateChecks, VISUAL_REQUIRED_CHECKS);
const PATH_CLASSIFICATION = {
  productPrefixes: normalizeConfigPathArray(AGENT_CONFIG.pathClassification?.productPrefixes, ['app', 'components', 'features', 'assets', 'src', 'pages']),
  dataPrefixes: normalizeConfigPathArray(AGENT_CONFIG.pathClassification?.dataPrefixes, [
    'lib',
    'hooks',
    'store',
    'types',
    'server',
    'api',
    'db',
    'database',
    'migrations',
    'supabase',
  ]),
  verifyPrefixes: normalizeConfigPathArray(AGENT_CONFIG.pathClassification?.verifyPrefixes, ['tests', 'test', '__tests__', 'spec']),
  docsPrefixes: normalizeConfigPathArray(AGENT_CONFIG.pathClassification?.docsPrefixes, ['docs', 'scripts']),
  docsFiles: normalizeConfigPathArray(AGENT_CONFIG.pathClassification?.docsFiles, ['README.md']),
};
const PLANNING_PRODUCT_FALLBACK_PATHS = normalizeConfigPathArray(AGENT_CONFIG.planning?.productFallbackPaths, ['app', 'src', 'components', 'features']);
const PLANNING_DATA_FALLBACK_PATHS = normalizeConfigPathArray(AGENT_CONFIG.planning?.dataFallbackPaths, ['lib', 'hooks', 'store', 'types']);
const PLANNING_VERIFY_FALLBACK_PATHS = normalizeConfigPathArray(AGENT_CONFIG.planning?.verifyFallbackPaths, ['tests']);
const PLANNING_DOCS_FALLBACK_PATHS = normalizeConfigPathArray(AGENT_CONFIG.planning?.docsFallbackPaths, ['README.md', 'docs']);
const DEFAULT_DOMAIN_NAMES = normalizeConfigStringArray(AGENT_CONFIG.planning?.defaultDomains, ['app']);
const PLANNING_AGENT_SIZING = {
  minAgents: normalizeConfigInteger(AGENT_CONFIG.planning?.agentSizing?.minAgents, 1, 1, Math.max(AGENT_IDS.length, 1)),
  maxAgents: normalizeConfigInteger(AGENT_CONFIG.planning?.agentSizing?.maxAgents, AGENT_IDS.length, 1, Math.max(AGENT_IDS.length, 1)),
  mediumComplexityScore: normalizeConfigInteger(AGENT_CONFIG.planning?.agentSizing?.mediumComplexityScore, 10, 1, 1000),
  largeComplexityScore: normalizeConfigInteger(AGENT_CONFIG.planning?.agentSizing?.largeComplexityScore, 16, 1, 1000),
  productKeywords: normalizeConfigStringArray(AGENT_CONFIG.planning?.agentSizing?.productKeywords, [
    'ui',
    'screen',
    'page',
    'view',
    'component',
    'layout',
    'modal',
    'button',
    'nav',
    'sidebar',
    'mobile',
    'desktop',
    'polish',
  ]).map((entry) => entry.toLowerCase()),
  dataKeywords: normalizeConfigStringArray(AGENT_CONFIG.planning?.agentSizing?.dataKeywords, [
    'api',
    'backend',
    'server',
    'database',
    'db',
    'schema',
    'migration',
    'supabase',
    'auth',
    'state',
    'store',
    'query',
    'cache',
    'sync',
    'integration',
    'share',
    'sharing',
    'invite',
    'calendar',
  ]).map((entry) => entry.toLowerCase()),
  verifyKeywords: normalizeConfigStringArray(AGENT_CONFIG.planning?.agentSizing?.verifyKeywords, [
    'test',
    'tests',
    'verify',
    'verification',
    'visual',
    'snapshot',
    'playwright',
    'coverage',
    'qa',
  ]).map((entry) => entry.toLowerCase()),
  docsKeywords: normalizeConfigStringArray(AGENT_CONFIG.planning?.agentSizing?.docsKeywords, [
    'doc',
    'docs',
    'documentation',
    'readme',
    'notes',
    'guide',
    'roadmap',
    'changelog',
  ]).map((entry) => entry.toLowerCase()),
};
const DOMAIN_RULES = normalizeDomainRules(AGENT_CONFIG.domainRules, DEFAULT_DOMAIN_RULES);
const APP_NOTE_CATEGORIES = new Set(normalizeConfigStringArray(AGENT_CONFIG.notes?.categories, DEFAULT_APP_NOTE_CATEGORIES));
const APP_NOTES_SECTION_HEADING = normalizeConfigString(AGENT_CONFIG.notes?.sectionHeading, 'Agent-Maintained Notes');

function resolveCliEntrypoint() {
  const override = String(process.env.AGENT_COORDINATION_CLI_ENTRYPOINT ?? '').trim();
  if (override) {
    return override;
  }

  const lifecycleEvent = String(process.env.npm_lifecycle_event ?? '').trim();

  if (lifecycleEvent.startsWith('agents2')) {
    return 'agents2';
  }

  if (lifecycleEvent.startsWith('agents')) {
    return 'agents';
  }

  if (path.basename(process.argv[1] ?? '') === 'agent-coordination-two.mjs') {
    return 'agents2';
  }

  return 'agents';
}

function resolveRepoPath(value, fallbackRelativePath) {
  const normalized = String(value ?? '').trim() || fallbackRelativePath;
  return path.isAbsolute(normalized) ? normalized : path.resolve(ROOT, normalized);
}

function cliRunLabel(commandSuffix = '') {
  return commandSuffix ? `npm run ${CLI_ENTRYPOINT}${commandSuffix}` : `npm run ${CLI_ENTRYPOINT}`;
}

function resolveAgentConfigPath() {
  const override = String(process.env.AGENT_COORDINATION_CONFIG ?? '').trim();
  if (override) {
    return resolveRepoPath(override, override);
  }

  return path.join(ROOT, 'agent-coordination.config.json');
}

function loadAgentCoordinationConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read agent coordination config at ${configPath}: ${error.message}`);
  }
}

function normalizeConfigString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeConfigStringArray(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}

function normalizeConfigInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(normalized, min), max);
}

function normalizeConfigPath(value) {
  return normalizePath(String(value ?? '').trim());
}

function normalizeConfigPathArray(value, fallback = []) {
  return normalizeConfigStringArray(value, fallback).map(normalizePath).filter(Boolean);
}

function normalizeDomainRules(value, fallback = DEFAULT_DOMAIN_RULES) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  const rules = [];

  for (const rule of source) {
    const name = normalizeConfigString(rule?.name);
    if (!name) {
      continue;
    }

    rules.push({
      name,
      keywords: normalizeConfigStringArray(rule?.keywords, [name.toLowerCase()]).map((keyword) => keyword.toLowerCase()),
      scopes: {
        product: normalizeConfigPathArray(rule?.scopes?.product, []),
        data: normalizeConfigPathArray(rule?.scopes?.data, []),
        verify: normalizeConfigPathArray(rule?.scopes?.verify, []),
        docs: normalizeConfigPathArray(rule?.scopes?.docs, []),
      },
    });
  }

  return rules.length ? rules : DEFAULT_DOMAIN_RULES;
}

let docsLibraryCache = null;
let currentCommandName = 'unknown';

function nowIso() {
  return new Date().toISOString();
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function normalizePath(inputPath) {
  if (!inputPath) {
    return '';
  }

  let normalized = inputPath.trim().replaceAll('\\', '/');

  if (path.isAbsolute(normalized)) {
    normalized = path.relative(ROOT, normalized).replaceAll('\\', '/');
  }

  normalized = normalized.replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

  return normalized;
}

function normalizePaths(inputs) {
  return [...new Set(inputs.map(normalizePath).filter(Boolean))].sort();
}

function tokenizeForDocs(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3))];
}

function getDocsLibrary() {
  if (docsLibraryCache) {
    return docsLibraryCache;
  }

  const files = [];

  for (const docsRootEntry of DOCS_ROOTS) {
    const docsRoot = path.join(ROOT, docsRootEntry);

    if (!fileExists(docsRoot)) {
      continue;
    }

    const stack = [docsRoot];

    while (stack.length) {
      const current = stack.pop();

      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolutePath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          files.push(absolutePath);
        }
      }
    }
  }

  docsLibraryCache = [...new Set(files)].map((absolutePath) => {
    const relativePath = normalizePath(path.relative(ROOT, absolutePath));
    const content = fs.readFileSync(absolutePath, 'utf8').slice(0, 5000).toLowerCase();

    return {
      path: relativePath,
      haystack: `${relativePath.toLowerCase()}\n${content}`,
      isVisualGuide:
        /visual|wireframe|rebuild|design|layout|modal/.test(relativePath.toLowerCase()) ||
        /wireframe|visual workflow|rebuild rules|design rules|wireframe anchors/.test(content),
    };
  });

  return docsLibraryCache;
}

function withAppAgentNotes(docs) {
  if (!APP_AGENT_NOTES_DOC || !fileExists(path.join(ROOT, APP_AGENT_NOTES_DOC))) {
    return docs;
  }

  return [APP_AGENT_NOTES_DOC, ...docs.filter((entry) => entry !== APP_AGENT_NOTES_DOC)];
}

function inferRelevantDocs(claimedPaths, summary = '', verification = []) {
  const docsLibrary = getDocsLibrary();

  if (!docsLibrary.length) {
    return withAppAgentNotes([]);
  }

  const sourceText = `${claimedPaths.join(' ')} ${summary} ${verification.join(' ')}`;
  const tokens = tokenizeForDocs(sourceText);
  const normalizedPaths = normalizePaths(claimedPaths);
  const docs = [];

  for (const doc of docsLibrary) {
    let score = 0;

    for (const token of tokens) {
      if (doc.haystack.includes(token)) {
        score += 2;
      }
    }

    if (normalizedPaths.some((entry) => PATH_CLASSIFICATION.productPrefixes.some((prefix) => pathStartsWith(entry, prefix)))) {
      if (doc.isVisualGuide) {
        score += 4;
      }
    }

    if (normalizedPaths.some((entry) => PATH_CLASSIFICATION.dataPrefixes.some((prefix) => pathStartsWith(entry, prefix)))) {
      if (API_DOC_PATH_PREFIXES.some((prefix) => pathStartsWith(doc.path, prefix))) {
        score += 4;
      }
    }

    if (normalizedPaths.some((entry) => isVisualSuitePath(entry))) {
      if (doc.path === VISUAL_WORKFLOW_DOC || doc.path.includes('visual-workflow')) {
        score += 6;
      }
    }

    if (score > 0) {
      docs.push({ path: doc.path, score });
    }
  }

  const selectedDocs = docs
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 4)
    .map((entry) => entry.path);

  if (VISUAL_WORKFLOW_DOC && hasVisualImpact(normalizedPaths) && docsLibrary.some((doc) => doc.path === VISUAL_WORKFLOW_DOC)) {
    return withAppAgentNotes([VISUAL_WORKFLOW_DOC, ...selectedDocs.filter((entry) => entry !== VISUAL_WORKFLOW_DOC)]).slice(0, 4);
  }

  return withAppAgentNotes(selectedDocs).slice(0, 4);
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function hoursBetween(earlierIso, laterIso) {
  const earlier = Date.parse(earlierIso);
  const later = Date.parse(laterIso);

  if (!Number.isFinite(earlier) || !Number.isFinite(later)) {
    return 0;
  }

  return Math.max(0, (later - earlier) / (1000 * 60 * 60));
}

function isTaskStale(task, referenceIso = nowIso()) {
  return ACTIVE_TASK_STATUSES.has(task.status) && hoursBetween(task.updatedAt, referenceIso) >= STALE_TASK_HOURS;
}

function formatElapsed(earlierIso, laterIso = nowIso()) {
  const totalMinutes = Math.round(hoursBetween(earlierIso, laterIso) * 60);

  if (totalMinutes <= 0) {
    return 'just now';
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
}

function detectTerminalId() {
  const explicit = String(process.env.AGENT_TERMINAL_ID ?? '').trim();
  if (explicit) {
    return explicit;
  }

  const wtSession = String(process.env.WT_SESSION ?? '').trim();
  if (wtSession) {
    return `wt:${wtSession}`;
  }

  return null;
}

function ensureTaskDefaults(task) {
  if (!Array.isArray(task.claimedPaths)) {
    task.claimedPaths = [];
  }
  if (!Array.isArray(task.dependencies)) {
    task.dependencies = [];
  }
  if (!Array.isArray(task.verification)) {
    task.verification = [];
  }
  if (!Array.isArray(task.verificationLog)) {
    task.verificationLog = [];
  }
  if (!Array.isArray(task.notes)) {
    task.notes = [];
  }
  if (!('suggestedOwnerId' in task)) {
    task.suggestedOwnerId = null;
  }
  if (!('rationale' in task)) {
    task.rationale = '';
  }
  if (!('effort' in task)) {
    task.effort = 'unknown';
  }
  if (!('issueKey' in task)) {
    task.issueKey = null;
  }
  if (!Array.isArray(task.waitingOn)) {
    task.waitingOn = [];
  }
  if (!Array.isArray(task.relevantDocs)) {
    task.relevantDocs = [];
  }
  if (!('docsReviewedAt' in task)) {
    task.docsReviewedAt = null;
  }
  if (!('docsReviewedBy' in task)) {
    task.docsReviewedBy = null;
  }
}

function getLatestTaskNote(task, preferredKinds = []) {
  ensureTaskDefaults(task);
  const allowedKinds = preferredKinds.length ? new Set(preferredKinds) : null;

  for (let index = task.notes.length - 1; index >= 0; index -= 1) {
    const entry = task.notes[index];
    if (!allowedKinds || allowedKinds.has(entry.kind)) {
      return entry;
    }
  }

  return null;
}

function getTaskStatusReason(task) {
  ensureTaskDefaults(task);

  if (task.status === 'waiting' && task.waitingOn.length) {
    return `Waiting on ${task.waitingOn.join(', ')}.`;
  }

  const statusKinds = {
    active: ['progress', 'claim', 'message'],
    blocked: ['blocked', 'progress', 'message'],
    waiting: ['waiting', 'message', 'progress'],
    review: ['review', 'verify', 'progress', 'message'],
    handoff: ['handoff', 'progress', 'message'],
    released: ['release', 'message'],
    done: ['done', 'verify', 'message'],
    planned: ['message'],
  };
  const note = getLatestTaskNote(task, statusKinds[task.status] ?? []);
  return note?.body ?? 'No note recorded.';
}

function hasVisualVerificationCompanion(board, task) {
  if (!task.planId) {
    return false;
  }

  return board.tasks.some((candidate) => {
    if (candidate.id === task.id || candidate.planId !== task.planId) {
      return false;
    }

    ensureTaskDefaults(candidate);
    return candidate.dependencies.includes(task.id) && hasVisualCheck(candidate.verification);
  });
}

function getVisualVerificationChecksForTask(board, task) {
  ensureTaskDefaults(task);

  if (!hasVisualImpact(task.claimedPaths)) {
    return [];
  }

  if (hasVisualSuiteScope(task.claimedPaths)) {
    return hasVisualCheck(task.verification) && task.verification.includes('visual')
      ? ['visual']
      : VISUAL_SUITE_UPDATE_CHECKS;
  }

  if (hasVisualVerificationCompanion(board, task)) {
    return [];
  }

  return hasVisualCheck(task.verification) && task.verification.includes('visual') ? ['visual'] : VISUAL_REQUIRED_CHECKS;
}

function ensureVisualVerificationForTask(board, task) {
  const requiredChecks = getVisualVerificationChecksForTask(board, task);

  if (!requiredChecks.length) {
    return task.verification;
  }

  return mergeVerificationChecks(task.verification, requiredChecks);
}

function getMissingVisualPassingChecks(board, task) {
  const requiredChecks = getVisualVerificationChecksForTask(board, task);

  if (!requiredChecks.length) {
    return [];
  }

  const latestByCheck = getLatestVerificationOutcomes(task);
  return requiredChecks.filter((check) => latestByCheck.get(check) !== 'pass');
}

function buildVisualGuidanceBlock(task) {
  ensureTaskDefaults(task);

  if (!hasVisualImpact(task.claimedPaths)) {
    return '- No visual-suite impact inferred from claimed paths.';
  }

  const ownsSuite = hasVisualSuiteScope(task.claimedPaths);
  const expectedChecks = ownsSuite ? VISUAL_SUITE_UPDATE_CHECKS : VISUAL_REQUIRED_CHECKS;
  const lines = [
    '- Visual impact inferred from claimed paths.',
  ];

  if (APP_AGENT_NOTES_DOC) {
    lines.push(`- Review \`${APP_AGENT_NOTES_DOC}\` first for the app map and common risk areas.`);
  }

  if (VISUAL_WORKFLOW_DOC) {
    lines.push(`- Review \`${VISUAL_WORKFLOW_DOC}\` before coding or verification.`);
  }

  lines.push(
    `- Expected checks: ${expectedChecks.map((check) => `\`${check}\``).join(', ')}.`,
    '- If UI/layout/copy changed intentionally, update the route inventory or approved snapshots so `npm run visual:test` does not fail on expected drift.',
    ownsSuite
      ? '- This task owns visual suite files; run `npm run visual:doctor`, refresh with `npm run visual:update` when appropriate, then confirm with `npm run visual:test`.'
      : '- If this task does not own visual suite files, hand off to or coordinate with the verification task before marking the work complete.'
  );

  return lines.join('\n');
}

function buildDependencyInsight(board, dependencyTaskId, referenceIso = nowIso()) {
  const dependencyTask = getTask(board, dependencyTaskId);

  if (!dependencyTask) {
    return {
      dependencyTaskId,
      task: null,
      ownerId: null,
      status: 'missing',
      updatedAgo: 'unknown',
      reason: 'Dependency task is missing from the board.',
      needsAssist: true,
      assistAction: 'Recreate or re-plan the missing dependency task.',
      assistType: 'missing',
    };
  }

  ensureTaskDefaults(dependencyTask);

  let assistType = null;
  let assistAction = null;
  if (dependencyTask.status === 'blocked') {
    assistType = 'blocked';
    assistAction = dependencyTask.ownerId
      ? `Ask ${dependencyTask.ownerId} what is blocked and offer an unblock slice.`
      : 'Assign an owner and unblock the dependency.';
  } else if (dependencyTask.status === 'waiting') {
    assistType = 'waiting';
    assistAction = dependencyTask.ownerId
      ? `Ask ${dependencyTask.ownerId} whether you can help finish ${dependencyTask.waitingOn.join(', ') || 'their upstream dependency'}.`
      : 'Assign an owner and resolve the upstream dependency.';
  } else if (dependencyTask.status === 'review') {
    assistType = 'review';
    assistAction = `Help verify ${dependencyTaskId} or pick up its follow-up work.`;
  } else if (dependencyTask.status === 'handoff') {
    assistType = 'handoff';
    assistAction = `Pick up ${dependencyTaskId} or explicitly reassign it.`;
  } else if (dependencyTask.status === 'active' && isTaskStale(dependencyTask, referenceIso)) {
    assistType = 'stale';
    assistAction = dependencyTask.ownerId
      ? `Check with ${dependencyTask.ownerId} and offer help on the stalled work.`
      : 'Assign an owner before the stale work drifts further.';
  }

  return {
    dependencyTaskId,
    task: dependencyTask,
    ownerId: dependencyTask.ownerId ?? null,
    status: dependencyTask.status,
    updatedAgo: formatElapsed(dependencyTask.updatedAt, referenceIso),
    reason: getTaskStatusReason(dependencyTask),
    needsAssist: Boolean(assistType),
    assistAction,
    assistType,
  };
}

function buildWaitingInsights(board, task, referenceIso = nowIso()) {
  ensureTaskDefaults(task);
  return task.waitingOn.map((dependencyTaskId) => buildDependencyInsight(board, dependencyTaskId, referenceIso));
}

function getBoardSnapshot() {
  if (!fileExists(BOARD_PATH)) {
    return null;
  }

  try {
    const board = readJson(BOARD_PATH, null);
    if (!board) {
      return null;
    }

    return normalizeBoard(board);
  } catch {
    return null;
  }
}

function buildLockContentionSummary(lock, board, referenceIso = nowIso()) {
  const parts = [];
  const lockDetails = describeLock(lock);

  if (lockDetails) {
    parts.push(lockDetails);
  }

  if (board) {
    const waitingTask = board.tasks.find((task) => task.status === 'waiting');
    if (waitingTask) {
      const insight = buildWaitingInsights(board, waitingTask, referenceIso).find((entry) => entry.needsAssist) ??
        buildWaitingInsights(board, waitingTask, referenceIso)[0];
      if (insight) {
        const ownerLabel = insight.ownerId ?? 'unowned';
        parts.push(
          `${waitingTask.id} is waiting on ${insight.dependencyTaskId} (${insight.status}, ${ownerLabel}, updated ${insight.updatedAgo}). ${insight.reason}`
        );
      }
    } else {
      const blockedTask = board.tasks.find((task) => task.status === 'blocked');
      if (blockedTask) {
        parts.push(
          `${blockedTask.id} is blocked${blockedTask.ownerId ? ` by ${blockedTask.ownerId}` : ''}. ${getTaskStatusReason(blockedTask)}`
        );
      }
    }
  }

  return parts.join(' | ');
}

function buildAssistMessage(waitingTask, insight) {
  if (!waitingTask.ownerId || !insight.ownerId || waitingTask.ownerId === insight.ownerId) {
    return null;
  }

  if (insight.assistType === 'review') {
    return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. If review is the only thing left, I can help verify or take follow-up work.`;
  }

  if (insight.assistType === 'handoff') {
    return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. It looks unowned; if you want, I can pick up a slice so my dependency closes sooner.`;
  }

  return `I'm waiting on ${insight.dependencyTaskId} for ${waitingTask.id}. It looks ${insight.status}; what is stuck, and can I help unblock it?`;
}

function hasRecentAssistMessage(messages, waitingTask, insight, referenceIso = nowIso()) {
  if (!waitingTask.ownerId || !insight.ownerId) {
    return false;
  }

  return messages.some(
    (message) =>
      message.from === waitingTask.ownerId &&
      message.to === insight.ownerId &&
      message.taskId === insight.dependencyTaskId &&
      typeof message.body === 'string' &&
      message.body.includes(waitingTask.id) &&
      hoursBetween(message.at ?? referenceIso, referenceIso) <= ASSIST_MESSAGE_WINDOW_HOURS
  );
}

function maybeQueueAssistMessages(board, waitingTask, referenceIso = nowIso()) {
  ensureTaskDefaults(waitingTask);
  const existingMessages = readMessages();
  const sentMessages = [];

  for (const insight of buildWaitingInsights(board, waitingTask, referenceIso)) {
    const body = buildAssistMessage(waitingTask, insight);
    if (!body) {
      continue;
    }

    if (hasRecentAssistMessage(existingMessages, waitingTask, insight, referenceIso)) {
      continue;
    }

    const message = {
      at: referenceIso,
      from: waitingTask.ownerId,
      to: insight.ownerId,
      taskId: insight.dependencyTaskId,
      body,
    };
    appendMessage(message);
    appendJournalLine(
      `- ${referenceIso} | assist ping ${waitingTask.ownerId} -> ${insight.ownerId} on \`${insight.dependencyTaskId}\`: ${body}`
    );
    note(waitingTask, waitingTask.ownerId, 'assist-request', `Asked ${insight.ownerId} how to unblock ${insight.dependencyTaskId}.`);
    existingMessages.push(message);
    sentMessages.push(message);
  }

  return sentMessages;
}

function renderWaitingDetailLines(board, waitingTasks, referenceIso = nowIso()) {
  const lines = [];

  for (const waitingTask of waitingTasks) {
    const insights = buildWaitingInsights(board, waitingTask, referenceIso);
    if (!insights.length) {
      lines.push(`- ${waitingTask.id}: waiting, but no dependency detail is recorded.`);
      continue;
    }

    for (const insight of insights) {
      const ownerLabel = insight.ownerId ?? 'unowned';
      lines.push(
        `- ${waitingTask.id} -> ${insight.dependencyTaskId}: ${ownerLabel} | ${insight.status} | updated ${insight.updatedAgo} | ${insight.reason}`
      );
    }
  }

  return lines;
}

function collectAssistOpportunityLines(board, referenceIso = nowIso()) {
  const lines = [];
  const seen = new Set();

  for (const task of board.tasks.filter((entry) => entry.status === 'waiting')) {
    for (const insight of buildWaitingInsights(board, task, referenceIso)) {
      if (!insight.needsAssist) {
        continue;
      }

      const key = `${task.id}:${insight.dependencyTaskId}:${insight.assistType ?? 'assist'}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      lines.push(`- ${task.id} -> ${insight.dependencyTaskId}: ${insight.assistAction}`);
    }
  }

  for (const task of board.tasks.filter((entry) => entry.status === 'blocked')) {
    const key = `blocked:${task.id}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    lines.push(
      `- ${task.id}: ${task.ownerId ?? 'unowned'} is blocked. ${getTaskStatusReason(task)} Suggested assist: ${
        task.ownerId ? `check with ${task.ownerId} and offer the missing slice.` : 'assign an owner and unblock it.'
      }`
    );
  }

  return lines;
}

function formatTaskDoc(task) {
  ensureTaskDefaults(task);

  const noteLines = task.notes.length
    ? task.notes
        .map((note) => {
          const target = note.to ? ` -> ${note.to}` : '';
          return `- ${note.at} | ${note.agent} | ${note.kind}${target}: ${note.body}`;
        })
        .join('\n')
    : '- No notes yet.';

  const pathsBlock = task.claimedPaths.length ? task.claimedPaths.map((entry) => `- \`${entry}\``).join('\n') : '- None recorded.';
  const dependencyBlock = task.dependencies.length ? task.dependencies.map((entry) => `- \`${entry}\``).join('\n') : '- None recorded.';
  const verificationBlock = task.verification.length ? task.verification.map((entry) => `- \`${entry}\``).join('\n') : '- None recorded.';
  const visualGuidanceBlock = buildVisualGuidanceBlock(task);
  const verificationLogBlock = task.verificationLog.length
    ? task.verificationLog
        .map((entry) => `- ${entry.at} | ${entry.agent} | \`${entry.check}\` | ${entry.outcome}${entry.details ? `: ${entry.details}` : ''}`)
        .join('\n')
    : '- No verification runs recorded.';
  const docsBlock = task.relevantDocs.length ? task.relevantDocs.map((entry) => `- \`${entry}\``).join('\n') : '- None suggested.';
  const handoffBlock = task.lastHandoff
    ? `- ${task.lastHandoff.at} from \`${task.lastHandoff.from}\`${task.lastHandoff.to ? ` to \`${task.lastHandoff.to}\`` : ''}: ${task.lastHandoff.body}`
    : '- No handoff recorded.';

  return `# ${task.id}

- Status: \`${task.status}\`
- Current owner: ${task.ownerId ? `\`${task.ownerId}\`` : 'unclaimed'}
- Last owner: ${task.lastOwnerId ? `\`${task.lastOwnerId}\`` : 'none'}
- Suggested owner: ${task.suggestedOwnerId ? `\`${task.suggestedOwnerId}\`` : 'none'}
- Issue key: ${task.issueKey ? `\`${task.issueKey}\`` : 'none'}
- Waiting on: ${task.waitingOn.length ? task.waitingOn.map((entry) => `\`${entry}\``).join(', ') : 'none'}
- Effort: ${task.effort}
- Docs reviewed: ${task.docsReviewedAt ? `${task.docsReviewedAt}${task.docsReviewedBy ? ` by \`${task.docsReviewedBy}\`` : ''}` : 'not yet'}
- Rationale: ${task.rationale || 'No rationale recorded.'}
- Created: ${task.createdAt}
- Updated: ${task.updatedAt}
- Summary: ${task.summary || 'No summary recorded.'}

## Claimed Paths

${pathsBlock}

## Dependencies

${dependencyBlock}

## Verification

${verificationBlock}

## Visual Suite

${visualGuidanceBlock}

## Relevant Docs

${docsBlock}

## Verification Log

${verificationLogBlock}

## Latest Handoff

${handoffBlock}

## Notes

${noteLines}
`;
}

function createInitialBoard() {
  const createdAt = nowIso();

  return {
    version: 1,
    workspace: COORDINATION_LABEL,
    createdAt,
    updatedAt: createdAt,
    agents: AGENT_IDS.map((id) => ({
      id,
      status: 'idle',
      taskId: null,
      updatedAt: createdAt,
    })),
    incidents: [],
    resources: [],
    accessRequests: [],
    plans: [],
    tasks: [],
  };
}

function normalizeIso(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

function normalizeAgentRecord(agent, agentId, fallbackIso) {
  return {
    id: agentId,
    status: typeof agent?.status === 'string' && agent.status ? agent.status : 'idle',
    taskId: typeof agent?.taskId === 'string' && agent.taskId ? agent.taskId : null,
    updatedAt: normalizeIso(agent?.updatedAt, fallbackIso),
  };
}

function normalizeBoard(board) {
  const fallbackBoard = createInitialBoard();
  const normalized = board && typeof board === 'object' ? board : fallbackBoard;

  normalized.version = Number.isInteger(normalized.version) ? normalized.version : fallbackBoard.version;
  normalized.workspace = COORDINATION_LABEL;
  normalized.createdAt = normalizeIso(normalized.createdAt, fallbackBoard.createdAt);
  normalized.updatedAt = normalizeIso(normalized.updatedAt, normalized.createdAt);

  const inputAgents = Array.isArray(normalized.agents) ? normalized.agents : [];
  const normalizedAgentSlots = AGENT_IDS.map((agentId) =>
    normalizeAgentRecord(
      inputAgents.find((agent) => agent?.id === agentId),
      agentId,
      normalized.updatedAt
    )
  );
  const seenAgentIds = new Set(AGENT_IDS);
  const malformedAgents = inputAgents.filter((agent, index) => {
    if (!agent?.id || typeof agent.id !== 'string') {
      return true;
    }

    const firstIndex = inputAgents.findIndex((candidate) => candidate?.id === agent.id);
    return !seenAgentIds.has(agent.id) || firstIndex !== index;
  });
  normalized.agents = [...normalizedAgentSlots, ...malformedAgents];

  normalized.incidents = Array.isArray(normalized.incidents) ? normalized.incidents : [];
  normalized.resources = Array.isArray(normalized.resources) ? normalized.resources : [];
  normalized.accessRequests = Array.isArray(normalized.accessRequests) ? normalized.accessRequests : [];
  normalized.plans = Array.isArray(normalized.plans) ? normalized.plans : [];
  normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
  for (const task of normalized.tasks) {
    ensureTaskDefaults(task);
  }

  return normalized;
}

async function writeTextAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fsp.writeFile(tempPath, content, 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function writeTextAtomicSync(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomicSync(filePath, value) {
  writeTextAtomicSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, fallback) {
  if (!fileExists(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${path.relative(ROOT, filePath)}: ${error.message}`);
  }
}

function readMessages() {
  if (!fileExists(MESSAGES_PATH)) {
    return [];
  }

  return fs
    .readFileSync(MESSAGES_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse ${path.relative(ROOT, MESSAGES_PATH)} line ${index + 1}: ${error.message}`);
      }
    });
}

function appendJournalLine(line) {
  fs.appendFileSync(JOURNAL_PATH, `${line}\n`, 'utf8');
}

function appendMessage(message) {
  fs.appendFileSync(MESSAGES_PATH, `${JSON.stringify(message)}\n`, 'utf8');
}

function sanitizeAppNoteText(value) {
  return String(value ?? '')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAppNotePaths(paths) {
  return paths.length ? paths.map((entry) => `\`${sanitizeAppNoteText(entry)}\``).join(', ') : 'none';
}

function getAppNotesSectionHeading() {
  return `## ${APP_NOTES_SECTION_HEADING}`;
}

function ensureAppNotesSection(content) {
  const normalizedContent = content.trimEnd();
  const heading = getAppNotesSectionHeading();

  if (normalizedContent.includes(heading)) {
    return normalizedContent;
  }

  return `${normalizedContent}\n\n${heading}\n\nAgents append durable discoveries here when they find errors, inconsistencies, gotchas, decisions, or behavior changes that should survive beyond one task.\n`;
}

function formatAppNoteEntry(entry) {
  const parts = [
    `- ${entry.timestamp}`,
    `agent: \`${sanitizeAppNoteText(entry.agentId)}\``,
    `category: \`${sanitizeAppNoteText(entry.category)}\``,
  ];

  if (entry.taskId) {
    parts.push(`task: \`${sanitizeAppNoteText(entry.taskId)}\``);
  }

  parts.push(`paths: ${formatAppNotePaths(entry.paths)}`);
  parts.push(sanitizeAppNoteText(entry.body));

  return parts.join(' | ');
}

function appendAppNoteEntry(entry) {
  if (!APP_AGENT_NOTES_DOC) {
    throw new Error('No app notes document is configured. Set docs.appNotes in agent-coordination.config.json.');
  }

  const appNotesPath = path.join(ROOT, APP_AGENT_NOTES_DOC);
  ensureDirectory(path.dirname(appNotesPath));

  const initialContent = fileExists(appNotesPath)
    ? fs.readFileSync(appNotesPath, 'utf8')
    : `# ${PROJECT_NAME} AI Agent App Notes\n\nUse this as the compact handoff document for agents working in this repository.\n`;
  const contentWithSection = ensureAppNotesSection(initialContent);
  writeTextAtomicSync(appNotesPath, `${contentWithSection}\n${formatAppNoteEntry(entry)}\n`);
}

function getAgentHeartbeatPath(agentId) {
  return path.join(AGENT_HEARTBEATS_ROOT, `${agentId}.json`);
}

function getHeartbeatMaxAgeMs(heartbeat) {
  const intervalMs = Number.parseInt(String(heartbeat?.intervalMs ?? AGENT_HEARTBEAT_INTERVAL_MS), 10);
  return Math.max(Number.isFinite(intervalMs) ? intervalMs * 3 : AGENT_HEARTBEAT_INTERVAL_MS * 3, AGENT_HEARTBEAT_TTL_MS);
}

function getHeartbeatAgeMs(heartbeat, referenceIso = nowIso()) {
  const lastHeartbeatAt = Date.parse(heartbeat?.lastHeartbeatAt ?? heartbeat?.startedAt ?? '');
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(lastHeartbeatAt) || !Number.isFinite(reference)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, reference - lastHeartbeatAt);
}

function isAgentHeartbeatAlive(heartbeat, referenceIso = nowIso()) {
  if (!heartbeat || typeof heartbeat !== 'object') {
    return false;
  }

  if (typeof heartbeat.pid !== 'number' || !isPidAlive(heartbeat.pid)) {
    return false;
  }

  return getHeartbeatAgeMs(heartbeat, referenceIso) <= getHeartbeatMaxAgeMs(heartbeat);
}

function readAgentHeartbeat(agentId, referenceIso = nowIso(), options = {}) {
  const cleanupStale = options.cleanupStale !== false;
  const heartbeatPath = getAgentHeartbeatPath(agentId);
  const heartbeat = readJson(heartbeatPath, null);
  if (!heartbeat) {
    return null;
  }

  const normalized = {
    agentId,
    pid: heartbeat.pid,
    terminalId: typeof heartbeat.terminalId === 'string' && heartbeat.terminalId ? heartbeat.terminalId : null,
    startedAt: typeof heartbeat.startedAt === 'string' ? heartbeat.startedAt : null,
    lastHeartbeatAt: typeof heartbeat.lastHeartbeatAt === 'string' ? heartbeat.lastHeartbeatAt : null,
    intervalMs: Number.parseInt(String(heartbeat.intervalMs ?? AGENT_HEARTBEAT_INTERVAL_MS), 10),
    taskId: typeof heartbeat.taskId === 'string' && heartbeat.taskId ? heartbeat.taskId : null,
    taskStatus: typeof heartbeat.taskStatus === 'string' && heartbeat.taskStatus ? heartbeat.taskStatus : null,
    boardUpdatedAt: typeof heartbeat.boardUpdatedAt === 'string' ? heartbeat.boardUpdatedAt : null,
    workspace: typeof heartbeat.workspace === 'string' && heartbeat.workspace ? heartbeat.workspace : COORDINATION_LABEL,
    command: typeof heartbeat.command === 'string' && heartbeat.command ? heartbeat.command : null,
  };

  if (!isAgentHeartbeatAlive(normalized, referenceIso)) {
    if (cleanupStale) {
      clearAgentHeartbeat(agentId);
    }
    return null;
  }

  return normalized;
}

function readAgentHeartbeats(referenceIso = nowIso(), options = {}) {
  const heartbeats = new Map();

  for (const agentId of AGENT_IDS) {
    const heartbeat = readAgentHeartbeat(agentId, referenceIso, options);
    if (heartbeat) {
      heartbeats.set(agentId, heartbeat);
    }
  }

  return heartbeats;
}

function writeAgentHeartbeatSync(agentId, heartbeat) {
  ensureBaseFiles();
  writeJsonAtomicSync(getAgentHeartbeatPath(agentId), heartbeat);
}

function clearAgentHeartbeat(agentId, expectedPid = null) {
  const heartbeatPath = getAgentHeartbeatPath(agentId);
  if (!fileExists(heartbeatPath)) {
    return;
  }

  if (expectedPid != null) {
    const heartbeat = readJson(heartbeatPath, null);
    if (!heartbeat || heartbeat.pid !== expectedPid) {
      return;
    }
  }

  fs.rmSync(heartbeatPath, { force: true });
}

function renderHeartbeatLine(heartbeat, referenceIso = nowIso()) {
  const parts = [`- ${heartbeat.agentId}: pid ${heartbeat.pid}`];
  parts.push(`last beat ${formatElapsed(heartbeat.lastHeartbeatAt ?? heartbeat.startedAt ?? referenceIso, referenceIso)}`);
  if (heartbeat.terminalId) {
    parts.push(`terminal ${heartbeat.terminalId}`);
  }
  if (heartbeat.taskId) {
    parts.push(`task ${heartbeat.taskId}${heartbeat.taskStatus ? ` (${heartbeat.taskStatus})` : ''}`);
  }
  return parts.join(' | ');
}

function assertAgentSessionAvailable(agentId, commandName = currentCommandName, options = {}) {
  const heartbeat = readAgentHeartbeat(agentId, nowIso(), options);
  if (!heartbeat) {
    return;
  }

  if (!TERMINAL_ID || !heartbeat.terminalId) {
    return;
  }

  if (heartbeat.terminalId === TERMINAL_ID) {
    return;
  }

  throw new Error(
    `${agentId} already has a live heartbeat in terminal ${heartbeat.terminalId} (pid ${heartbeat.pid}${heartbeat.taskId ? `, task ${heartbeat.taskId}` : ''}). Refusing ${commandName} from terminal ${TERMINAL_ID}. Stop the other heartbeat or choose a different agent.`
  );
}

function getWatcherStatus() {
  return readJson(WATCHER_STATUS_PATH, null);
}

function isWatcherAlive(status = getWatcherStatus()) {
  return Boolean(status && typeof status.pid === 'number' && isPidAlive(status.pid));
}

function ensureBaseFiles() {
  ensureDirectory(COORDINATION_ROOT);
  ensureDirectory(TASKS_ROOT);
  ensureDirectory(RUNTIME_ROOT);
  ensureDirectory(AGENT_HEARTBEATS_ROOT);

  if (!fileExists(BOARD_PATH)) {
    fs.writeFileSync(BOARD_PATH, `${JSON.stringify(createInitialBoard(), null, 2)}\n`, 'utf8');
  }

  if (!fileExists(JOURNAL_PATH)) {
    fs.writeFileSync(JOURNAL_PATH, '# Agent Journal\n\n', 'utf8');
  }

  if (!fileExists(MESSAGES_PATH)) {
    fs.writeFileSync(MESSAGES_PATH, '', 'utf8');
  }
}

function getBoard() {
  ensureBaseFiles();
  return normalizeBoard(readJson(BOARD_PATH, createInitialBoard()));
}

function getReadOnlyBoard() {
  return getBoardSnapshot() ?? createInitialBoard();
}

function hasLiveAgentHeartbeat(agentId, liveHeartbeats = readAgentHeartbeats()) {
  return Boolean(agentId && liveHeartbeats.has(agentId));
}

function isResourceStale(resource, referenceIso = nowIso()) {
  return hoursBetween(resource.updatedAt ?? resource.createdAt ?? referenceIso, referenceIso) >= RESOURCE_STALE_HOURS;
}

function isIncidentStale(incident, referenceIso = nowIso()) {
  return incident.status === 'open' && hoursBetween(incident.updatedAt ?? incident.createdAt ?? referenceIso, referenceIso) >= STALE_INCIDENT_HOURS;
}

function getStaleResources(board, liveHeartbeats = readAgentHeartbeats(), referenceIso = nowIso()) {
  return board.resources.filter((resource) => isResourceStale(resource, referenceIso) && !hasLiveAgentHeartbeat(resource.ownerId, liveHeartbeats));
}

function cleanupStaleResources(board, liveHeartbeats = readAgentHeartbeats(), referenceIso = nowIso()) {
  const staleResources = getStaleResources(board, liveHeartbeats, referenceIso);
  if (!staleResources.length) {
    return [];
  }

  board.resources = board.resources.filter(
    (resource) => !(isResourceStale(resource, referenceIso) && !hasLiveAgentHeartbeat(resource.ownerId, liveHeartbeats))
  );
  return staleResources;
}

function getAgent(board, agentId) {
  if (!AGENT_IDS.includes(agentId)) {
    throw new Error(`Unknown agent "${agentId}". Expected one of: ${AGENT_IDS.join(', ')}.`);
  }

  const agent = board.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    throw new Error(`Unknown agent "${agentId}". Expected one of: ${AGENT_IDS.join(', ')}.`);
  }

  return agent;
}

function getCommandAgent(board, agentId) {
  assertAgentSessionAvailable(agentId);
  return getAgent(board, agentId);
}

function getTask(board, taskId) {
  return board.tasks.find((task) => task.id === taskId) ?? null;
}

function getAccessRequest(board, requestId) {
  return board.accessRequests.find((request) => request.id === requestId) ?? null;
}

function findActiveAccessRequestByScope(board, scope) {
  return board.accessRequests.find((request) => request.scope === scope && ['pending', 'granted'].includes(request.status)) ?? null;
}

function ensureTask(board, taskId) {
  const task = getTask(board, taskId);

  if (!task) {
    throw new Error(`Unknown task "${taskId}". Claim it first or run "${cliRunLabel(' -- claim ...')}".`);
  }

  ensureTaskDefaults(task);
  return task;
}

function note(task, agentId, kind, body, extra = {}) {
  ensureTaskDefaults(task);
  task.notes.push({
    at: nowIso(),
    agent: agentId,
    kind,
    body,
    ...extra,
  });
}

async function syncTaskDocs(board) {
  const activeTaskFiles = new Set();

  for (const task of board.tasks) {
    const taskPath = path.join(TASKS_ROOT, `${task.id}.md`);
    activeTaskFiles.add(taskPath);
    await writeTextAtomic(taskPath, formatTaskDoc(task));
  }

  if (!fileExists(TASKS_ROOT)) {
    return;
  }

  for (const entry of fs.readdirSync(TASKS_ROOT)) {
    const taskPath = path.join(TASKS_ROOT, entry);

    if (entry.endsWith('.md') && !activeTaskFiles.has(taskPath)) {
      fs.rmSync(taskPath, { force: true });
    }
  }
}

async function saveBoard(board) {
  board.updatedAt = nowIso();
  await writeJsonAtomic(BOARD_PATH, board);
  await syncTaskDocs(board);
}

async function writeWatcherStatus(status) {
  ensureBaseFiles();
  await writeJsonAtomic(WATCHER_STATUS_PATH, status);
}

function clearWatcherStatus() {
  fs.rmSync(WATCHER_STATUS_PATH, { force: true });
}

function describeLock(lock) {
  if (!lock || typeof lock !== 'object') {
    return null;
  }

  const parts = [];

  if (typeof lock.pid === 'number') {
    parts.push(`pid ${lock.pid}`);
  }

  if (typeof lock.command === 'string' && lock.command) {
    parts.push(`command ${lock.command}`);
  }

  if (typeof lock.terminalId === 'string' && lock.terminalId) {
    parts.push(`terminal ${lock.terminalId}`);
  }

  if (typeof lock.lockedAt === 'string' && lock.lockedAt) {
    parts.push(`locked ${lock.lockedAt}`);
  }

  return parts.length ? parts.join(', ') : null;
}

function isMutationLockStale(lock, referenceMs = Date.now()) {
  if (!lock || typeof lock !== 'object') {
    return true;
  }

  if (typeof lock.pid !== 'number' || !isPidAlive(lock.pid)) {
    return true;
  }

  const lockedAtMs = Date.parse(lock.lockedAt ?? '');
  return !Number.isFinite(lockedAtMs) || referenceMs - lockedAtMs >= LOCK_STALE_AFTER_MS;
}

async function acquireMutationLock() {
  ensureDirectory(RUNTIME_ROOT);
  const startedAt = Date.now();
  let nextDiagnosticAt = startedAt + LOCK_DIAGNOSTIC_INTERVAL_MS;

  while (Date.now() - startedAt <= LOCK_WAIT_TIMEOUT_MS) {
    if (fileExists(LOCK_PATH)) {
      try {
        const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
        if (isMutationLockStale(lock)) {
          fs.rmSync(LOCK_PATH, { force: true });
        }
      } catch {
        fs.rmSync(LOCK_PATH, { force: true });
      }
    }

    try {
      const handle = await fsp.open(LOCK_PATH, 'wx');
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          command: currentCommandName,
          args: process.argv.slice(2),
          workspace: COORDINATION_LABEL,
          terminalId: String(process.env.AGENT_TERMINAL_ID ?? '').trim() || null,
          lockedAt: nowIso(),
        })
      );
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }

    if (Date.now() >= nextDiagnosticAt) {
      const lock = readJson(LOCK_PATH, null);
      const board = getBoardSnapshot();
      const summary = buildLockContentionSummary(lock, board);
      console.error(
        summary
          ? `Still waiting for workspace "${COORDINATION_LABEL}" lock: ${summary}`
          : `Still waiting for workspace "${COORDINATION_LABEL}" lock.`
      );
      nextDiagnosticAt = Date.now() + LOCK_DIAGNOSTIC_INTERVAL_MS;
    }

    await delay(LOCK_POLL_INTERVAL_MS);
  }

  const lock = readJson(LOCK_PATH, null);
  const board = getBoardSnapshot();
  const details = buildLockContentionSummary(lock, board);
  throw new Error(
    `The coordination workspace "${COORDINATION_LABEL}" is busy${details ? `: ${details}` : ''}. Wait longer or help clear the blocker, then retry the command.`
  );
}

function releaseMutationLock() {
  if (!fileExists(LOCK_PATH)) {
    return;
  }

  const lock = readJson(LOCK_PATH, null);
  if (lock?.pid !== process.pid) {
    return;
  }

  fs.rmSync(LOCK_PATH, { force: true });
}

async function withMutationLock(work) {
  await acquireMutationLock();

  try {
    return await work();
  } finally {
    releaseMutationLock();
  }
}

function parseArgs(rawArgs) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const rawKey = token.slice(2);
    const equalsIndex = rawKey.indexOf('=');
    if (equalsIndex >= 0) {
      const key = rawKey.slice(0, equalsIndex);
      if (!key) {
        throw new Error(`Invalid option "${token}".`);
      }
      options[key] = rawKey.slice(equalsIndex + 1);
      continue;
    }

    const key = rawKey;
    if (!key) {
      throw new Error(`Invalid option "${token}".`);
    }

    const next = rawArgs[index + 1];

    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}

function isReadOnlyCommand(commandName, options = {}) {
  if (ALWAYS_READ_ONLY_COMMANDS.has(commandName)) {
    return true;
  }

  if (commandName === 'plan' && !options.apply) {
    return true;
  }

  if (commandName === 'recover' && !options.apply) {
    return true;
  }

  return false;
}

function parsePathsOption(pathsValue) {
  if (typeof pathsValue !== 'string') {
    return [];
  }

  return normalizePaths(
    pathsValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function collectPathConflicts(board, agentId, taskId, claimedPaths) {
  const conflicts = [];

  for (const task of board.tasks) {
    if (!task.ownerId || task.ownerId === agentId || task.id === taskId || !ACTIVE_TASK_STATUSES.has(task.status)) {
      continue;
    }

    for (const claimedPath of claimedPaths) {
      const overlap = task.claimedPaths.find((taskPath) => pathsOverlap(taskPath, claimedPath));

      if (overlap) {
        conflicts.push({
          taskId: task.id,
          ownerId: task.ownerId,
          path: overlap,
        });
      }
    }
  }

  return conflicts;
}

function renderTaskLine(task, ownerLabel, liveHeartbeats = new Map(), referenceIso = nowIso()) {
  ensureTaskDefaults(task);
  const dependencyLabel = task.dependencies.length ? ` | depends on ${task.dependencies.join(', ')}` : '';
  const effortLabel = task.effort ? ` | effort ${task.effort}` : '';
  const unattendedStale = isTaskStale(task, referenceIso) && !hasLiveAgentHeartbeat(task.ownerId, liveHeartbeats);
  const staleLabel = unattendedStale ? ' | stale' : '';
  return `- ${task.id}: ${ownerLabel} -> ${task.claimedPaths.join(', ') || 'no paths'}${dependencyLabel}${effortLabel}${staleLabel} | ${
    task.summary || 'No summary'
  }`;
}

function renderStatus(board, options = {}) {
  const lines = [];
  const referenceIso = options.referenceIso ?? nowIso();
  const liveHeartbeats = options.liveHeartbeats ?? readAgentHeartbeats(referenceIso);
  const staleResources = Array.isArray(options.staleResources) ? options.staleResources : [];
  const watcherStatus = getWatcherStatus();
  const watcherAlive = isWatcherAlive(watcherStatus);

  lines.push(`Workspace: ${board.workspace}`);
  lines.push(`Updated: ${board.updatedAt}`);
  lines.push(
    `Watcher: ${
      watcherAlive
        ? `running (pid ${watcherStatus.pid})${watcherStatus.lastSweepAt ? ` | last sweep ${watcherStatus.lastSweepAt}` : ''}`
        : 'stopped'
    }`
  );
  lines.push('');
  lines.push('Agents:');

  for (const agent of board.agents) {
    const heartbeat = liveHeartbeats.get(agent.id);
    lines.push(
      `- ${agent.id}: ${agent.status}${agent.taskId ? ` (${agent.taskId})` : ''}${
        heartbeat ? ` | heartbeat ${formatElapsed(heartbeat.lastHeartbeatAt ?? heartbeat.startedAt ?? referenceIso, referenceIso)}` : ''
      }`
    );
  }

  const activeTasks = board.tasks.filter((task) => task.status === 'active');
  const blockedTasks = board.tasks.filter((task) => task.status === 'blocked');
  const reviewTasks = board.tasks.filter((task) => task.status === 'review');
  const waitingTasks = board.tasks.filter((task) => task.status === 'waiting');
  const plannedTasks = board.tasks.filter((task) => task.status === PLANNED_TASK_STATUS);
  const handoffTasks = board.tasks.filter((task) => task.status === 'handoff');

  lines.push('');
  lines.push('Active tasks:');
  lines.push(activeTasks.length ? activeTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

  lines.push('');
  lines.push('Blocked tasks:');
  lines.push(blockedTasks.length ? blockedTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

  lines.push('');
  lines.push('Waiting tasks:');
  lines.push(waitingTasks.length ? waitingTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

  lines.push('');
  lines.push('Waiting details:');
  lines.push(waitingTasks.length ? renderWaitingDetailLines(board, waitingTasks, referenceIso).join('\n') : '- none');

  lines.push('');
  lines.push('Review tasks:');
  lines.push(reviewTasks.length ? reviewTasks.map((task) => renderTaskLine(task, task.ownerId, liveHeartbeats, referenceIso)).join('\n') : '- none');

  lines.push('');
  lines.push('Planned tasks:');
  lines.push(
    plannedTasks.length
      ? plannedTasks.map((task) => renderTaskLine(task, `suggested ${task.suggestedOwnerId ?? 'unassigned'}`, liveHeartbeats, referenceIso)).join('\n')
      : '- none'
  );

  lines.push('');
  lines.push('Handoff-ready tasks:');
  lines.push(
    handoffTasks.length
      ? handoffTasks.map((task) => `- ${task.id}: last owner ${task.lastOwnerId ?? 'unknown'} | ${task.summary || 'No summary'}`).join('\n')
      : '- none'
  );

  lines.push('');
  lines.push('Resource locks:');
  lines.push(
    board.resources.length
      ? board.resources
          .map((resource) => `- ${resource.name}: ${resource.ownerId}${resource.taskId ? ` (${resource.taskId})` : ''} | ${resource.reason}`)
          .join('\n')
      : '- none'
  );

  lines.push('');
  lines.push('Access requests:');
  lines.push(
    board.accessRequests.length
      ? board.accessRequests
          .map(
            (request) =>
              `- ${request.id}: ${request.status} | ${request.requestedBy}${request.taskId ? ` (${request.taskId})` : ''} | scope ${request.scope} | ${request.reason}`
          )
          .join('\n')
      : '- none'
  );

  lines.push('');
  lines.push('Assist opportunities:');
  const assistLines = collectAssistOpportunityLines(board, referenceIso);
  lines.push(assistLines.length ? assistLines.join('\n') : '- none');

  lines.push('');
  lines.push('Agent heartbeats:');
  lines.push(liveHeartbeats.size ? [...liveHeartbeats.values()].map((heartbeat) => renderHeartbeatLine(heartbeat, referenceIso)).join('\n') : '- none');

  lines.push('');
  lines.push('Incidents:');
  lines.push(
    board.incidents.length
      ? board.incidents
          .map(
            (incident) =>
              `- ${incident.key}: ${incident.status} | owner ${incident.ownerId}${incident.resource ? ` | resource ${incident.resource}` : ''} | ${incident.summary}`
          )
          .join('\n')
      : '- none'
  );

  if (staleResources.length) {
    lines.push('');
    lines.push(`Expired resource locks removed: ${staleResources.map((resource) => resource.name).join(', ')}`);
  }

  return lines.join('\n');
}

async function statusCommand() {
  const board = getReadOnlyBoard();
  const referenceIso = nowIso();
  const liveHeartbeats = readAgentHeartbeats(referenceIso, { cleanupStale: false });
  const staleResources = getStaleResources(board, liveHeartbeats, referenceIso);

  console.log(renderStatus(board, { referenceIso, liveHeartbeats, staleResources }));
}

function printHelp() {
  const agentOne = getSuggestedAgent(0);
  const agentTwo = getSuggestedAgent(1);
  const agentThree = getSuggestedAgent(2);
  const visualRequiredLabel = VISUAL_REQUIRED_CHECKS.join(', ') || 'none configured';
  const visualSuiteLabel = VISUAL_SUITE_UPDATE_CHECKS.join(', ') || 'none configured';
  const exampleClaimPaths = PLANNING_PRODUCT_FALLBACK_PATHS.slice(0, 2).join(',') || 'src';
  const exampleVerificationCheck = VISUAL_REQUIRED_CHECKS[VISUAL_REQUIRED_CHECKS.length - 1] ?? 'typecheck';
  const visualPolicyLines = [];

  if (APP_AGENT_NOTES_DOC) {
    visualPolicyLines.push(`  - Review ${APP_AGENT_NOTES_DOC} first for the app map, data flow, verification commands, and shared-risk files.`);
  }

  visualPolicyLines.push(
    '  - Claims touching app, component, feature, asset, or visual fixture paths infer visual impact.',
    `  - Direct UI claims require passing visual verification before done: ${visualRequiredLabel}.`,
    `  - Visual-suite tasks own route/snapshot upkeep and should run ${visualSuiteLabel}.`,
    '  - When UI changes are intentional, update tests/visual routes or snapshots before recording visual:test as passing.'
  );

  if (VISUAL_WORKFLOW_DOC) {
    visualPolicyLines.push(`  - Review ${VISUAL_WORKFLOW_DOC} before coding or verifying visual-impact tasks.`);
  }

  console.log(`Agent coordination CLI

Project: ${PROJECT_NAME}
Workspace: ${COORDINATION_LABEL}
Config: ${fileExists(AGENT_CONFIG_PATH) ? path.relative(ROOT, AGENT_CONFIG_PATH).replaceAll('\\', '/') : 'built-in generic defaults'}

Commands:
  init
  status
  heartbeat <agent> [--interval <ms>]
  heartbeat-start <agent> [--interval <ms>]
  heartbeat-stop <agent>
  heartbeat-status [agent]
  watch
  watch-tick
  watch-start
  watch-stop
  watch-status
  plan <goal> [--apply] [--git-changes]
  claim <agent> <task-id> --paths <path[,path...]> [--summary <text>] [--force]
  pick <agent>
  review-docs <agent> <task-id> [--docs <path[,path...]>] [--note <text>]
  progress <agent> <task-id> <note>
  wait <agent> <task-id> --on <task-id[,task-id...]> --reason <text>
  resume <agent> <task-id> <note>
  blocked <agent> <task-id> <note>
  review <agent> <task-id> <note>
  verify <agent> <task-id> <check> <pass|fail> [--details <text>]
  request-access <agent> <task-id> <scope> <reason>
  grant-access <request-id> [--by <agent>] [--note <text>]
  deny-access <request-id> [--by <agent>] [--note <text>]
  complete-access <request-id> [--by <agent>] [--note <text>]
  start-incident <agent> <incident-key> <summary> [--resource <name>] [--task <task-id>]
  join-incident <agent> <incident-key> [--task <task-id>]
  close-incident <agent> <incident-key> <resolution>
  reserve-resource <agent> <resource> <reason> [--task <task-id>]
  release-resource <agent> <resource>
  message <from-agent> <to-agent|all> <message> [--task <task-id>]
  app-note <agent> <category> <note> [--task <task-id>] [--paths <path[,path...]>]
  inbox <agent> [--limit <count>]
  handoff <agent> <task-id> <note> [--to <agent>]
  handoff <agent> <task-id> --summary <text> --next <text> [--blocker <text>] [--to <agent>]
  release <agent> <task-id> [--note <text>]
  done <agent> <task-id> <note>
  validate
  doctor
  recover [--apply]

Examples:
  ${cliRunLabel(':init')}
  ${cliRunLabel(` -- heartbeat-start ${agentOne}`)}
  ${cliRunLabel(' -- heartbeat-status')}
  ${cliRunLabel(` -- heartbeat-stop ${agentOne}`)}
  ${cliRunLabel(' -- watch-start')}
  ${cliRunLabel(' -- watch-status')}
  ${cliRunLabel(' -- plan "Add task improvements and update verification coverage"')}
  ${cliRunLabel(' -- plan "Polish current branch work" --git-changes')}
  ${cliRunLabel(` -- claim ${agentOne} task-shell --paths ${exampleClaimPaths} --summary "Primary shell polish"`)}
  ${cliRunLabel(` -- pick ${agentThree}`)}
  ${cliRunLabel(` -- review-docs ${agentOne} task-shell --note "Checked app notes and relevant workflow docs."`)}
  ${cliRunLabel(` -- wait ${agentTwo} task-api --on task-shell --reason "Shared button API is in flux."`)}
  ${cliRunLabel(` -- resume ${agentTwo} task-api "Shared button API is stable again."`)}
  ${cliRunLabel(` -- blocked ${agentTwo} task-api "Waiting on schema decision."`)}
  ${cliRunLabel(` -- review ${agentOne} task-shell "Ready for verification."`)}
  ${cliRunLabel(` -- verify ${agentThree} task-shell ${exampleVerificationCheck} pass --details "Desktop and mobile look correct."`)}
  ${cliRunLabel(` -- request-access ${agentTwo} task-api dev-server "Need elevated restart to inspect startup failure."`)}
  ${cliRunLabel(` -- grant-access access-${agentTwo}-dev-server-task-api --by ${agentOne} --note "Approved shared restart window."`)}
  ${cliRunLabel(` -- complete-access access-${agentTwo}-dev-server-task-api --by ${agentTwo} --note "Restart finished."`)}
  ${cliRunLabel(` -- start-incident ${agentOne} server-not-loading "Investigating why the web server is not loading." --resource dev-server`)}
  ${cliRunLabel(` -- join-incident ${agentTwo} server-not-loading`)}
  ${cliRunLabel(` -- close-incident ${agentOne} server-not-loading "Server recovered after config fix."`)}
  ${cliRunLabel(` -- reserve-resource ${agentOne} dev-server "Investigating the server not loading." --task task-shell`)}
  ${cliRunLabel(` -- message ${agentOne} ${agentTwo} "I need the shared chip API to stay stable."`)}
  ${cliRunLabel(` -- app-note ${agentOne} inconsistency "Source routing affects active navigation state." --task task-shell --paths ${exampleClaimPaths}`)}
  ${cliRunLabel(` -- handoff ${agentOne} task-shell --summary "UI pass complete." --next "Run visual capture and compare snapshots." --to ${agentThree}`)}
  ${cliRunLabel(' -- doctor')}
  ${cliRunLabel(' -- recover --apply')}
  ${cliRunLabel(' -- watch-stop')}

Visual suite policy:
${visualPolicyLines.join('\n')}

Set AGENT_TERMINAL_ID in each terminal for stricter same-agent protection when you run multiple terminals outside Windows Terminal.
`);
}

function execGit(args) {
  const candidates = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];

  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }

  return null;
}

function parseGitStatusPath(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const renameSeparator = ' -> ';

  if ((status.includes('R') || status.includes('C')) && rawPath.includes(renameSeparator)) {
    return rawPath.slice(rawPath.lastIndexOf(renameSeparator) + renameSeparator.length);
  }

  return rawPath;
}

function sliceAfterNthSpace(value, count) {
  let index = -1;

  for (let seen = 0; seen < count; seen += 1) {
    index = value.indexOf(' ', index + 1);
    if (index === -1) {
      return '';
    }
  }

  return value.slice(index + 1);
}

function parseGitStatusPorcelainV2(output) {
  const records = output.split('\0');
  const paths = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith('#')) {
      continue;
    }

    const recordType = record[0];
    if (recordType === '1') {
      paths.push(sliceAfterNthSpace(record, 8));
      continue;
    }

    if (recordType === '2') {
      paths.push(sliceAfterNthSpace(record, 9));
      index += 1;
      continue;
    }

    if (recordType === 'u') {
      paths.push(sliceAfterNthSpace(record, 10));
      continue;
    }

    if (recordType === '?') {
      paths.push(record.slice(2));
    }
  }

  return normalizePaths(paths);
}

function getGitChangedPaths() {
  const porcelainV2Output = execGit(['status', '--porcelain=v2', '-z']);

  if (porcelainV2Output != null) {
    return { available: true, paths: parseGitStatusPorcelainV2(porcelainV2Output) };
  }

  const shortOutput = execGit(['status', '--short']);

  if (shortOutput == null) {
    return { available: false, paths: [] };
  }

  const paths = shortOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => normalizePath(parseGitStatusPath(line)))
    .filter(Boolean);

  return { available: true, paths: normalizePaths(paths) };
}

function isSourceFile(filePath) {
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase());
}

function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function isVisualSuitePath(filePath) {
  return VISUAL_SUITE_PATHS.some((prefix) => pathStartsWith(filePath, prefix));
}

function isVisualImpactPath(filePath) {
  return (
    isVisualSuitePath(filePath) ||
    VISUAL_IMPACT_PATHS.some((prefix) => pathStartsWith(filePath, prefix)) ||
    VISUAL_IMPACT_FILES.includes(filePath)
  );
}

function hasVisualImpact(paths) {
  return normalizePaths(paths).some((filePath) => isVisualImpactPath(filePath));
}

function hasVisualSuiteScope(paths) {
  return normalizePaths(paths).some((filePath) => isVisualSuitePath(filePath));
}

function hasVisualCheck(checks) {
  return checks.some((check) => check === 'visual' || check.startsWith('visual:'));
}

function mergeVerificationChecks(existingChecks, requiredChecks) {
  return [...new Set([...(existingChecks ?? []), ...requiredChecks])];
}

function isSharedRiskPath(filePath) {
  return SHARED_RISK_PATHS.some((prefix) => pathStartsWith(filePath, prefix));
}

function collectFilesFromClaimedPath(claimedPath, result = []) {
  const absolutePath = path.join(ROOT, claimedPath);

  if (!fileExists(absolutePath)) {
    return result;
  }

  const stat = fs.statSync(absolutePath);

  if (stat.isFile()) {
    if (isSourceFile(claimedPath)) {
      result.push(normalizePath(claimedPath));
    }
    return result;
  }

  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    const nextPath = normalizePath(path.join(claimedPath, entry.name));
    if (entry.isDirectory()) {
      collectFilesFromClaimedPath(nextPath, result);
      continue;
    }
    if (entry.isFile() && isSourceFile(nextPath)) {
      result.push(nextPath);
    }
  }

  return result;
}

function resolveImportPath(fromFile, specifier) {
  const candidates = [];

  if (specifier.startsWith('@/')) {
    candidates.push(path.join(ROOT, specifier.slice(2)));
  } else if (specifier.startsWith('.')) {
    candidates.push(path.resolve(path.dirname(path.join(ROOT, fromFile)), specifier));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    const variants = [
      candidate,
      `${candidate}.ts`,
      `${candidate}.tsx`,
      `${candidate}.js`,
      `${candidate}.jsx`,
      `${candidate}.mjs`,
      `${candidate}.cjs`,
      path.join(candidate, 'index.ts'),
      path.join(candidate, 'index.tsx'),
      path.join(candidate, 'index.js'),
      path.join(candidate, 'index.jsx'),
      path.join(candidate, 'index.mjs'),
      path.join(candidate, 'index.cjs'),
    ];

    for (const variant of variants) {
      if (fileExists(variant) && fs.statSync(variant).isFile()) {
        return normalizePath(path.relative(ROOT, variant));
      }
    }
  }

  return null;
}

function parseLocalImports(filePath) {
  const absolutePath = path.join(ROOT, filePath);
  if (!fileExists(absolutePath)) {
    return [];
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const matches = [...content.matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)];
  const imports = matches
    .map((match) => match[1] ?? match[2] ?? '')
    .map((specifier) => resolveImportPath(filePath, specifier))
    .filter(Boolean);

  return normalizePaths(imports);
}

function buildTaskFileSet(task) {
  return normalizePaths(task.claimedPaths.flatMap((claimedPath) => collectFilesFromClaimedPath(claimedPath)));
}

function collectMergeRiskWarnings(candidateTask, otherTasks) {
  const warnings = [];
  ensureTaskDefaults(candidateTask);
  const candidateFiles = buildTaskFileSet(candidateTask);
  const candidateImports = new Map(candidateFiles.map((filePath) => [filePath, parseLocalImports(filePath)]));

  for (const otherTask of otherTasks) {
    ensureTaskDefaults(otherTask);
    const otherFiles = buildTaskFileSet(otherTask);
    const otherImports = new Map(otherFiles.map((filePath) => [filePath, parseLocalImports(filePath)]));

    if (candidateTask.issueKey && otherTask.issueKey && candidateTask.issueKey === otherTask.issueKey) {
      warnings.push(`Task "${otherTask.id}" is already working the same issue key "${candidateTask.issueKey}".`);
    }

    for (const candidateFile of candidateFiles) {
      for (const importedFile of otherImports.values()) {
        if (importedFile.includes(candidateFile)) {
          warnings.push(`Task "${otherTask.id}" imports claimed file "${candidateFile}".`);
        }
      }
    }

    for (const otherFile of otherFiles) {
      for (const importedFile of candidateImports.values()) {
        if (importedFile.includes(otherFile)) {
          warnings.push(`Claimed files import "${otherFile}" from active task "${otherTask.id}".`);
        }
      }
    }

    const candidateSharedDeps = [...candidateImports.values()].flat().filter((filePath) => isSharedRiskPath(filePath));
    const otherSharedDeps = [...otherImports.values()].flat().filter((filePath) => isSharedRiskPath(filePath));
    const sharedOverlap = candidateSharedDeps.find((filePath) => otherSharedDeps.includes(filePath));
    if (sharedOverlap) {
      warnings.push(`Both tasks depend on shared hotspot "${sharedOverlap}".`);
    }

    const hotspotClaim = candidateTask.claimedPaths.find((filePath) => isSharedRiskPath(filePath));
    if (hotspotClaim) {
      const consumer = [...otherImports.values()].some((imports) => imports.some((imported) => pathStartsWith(imported, hotspotClaim) || imported === hotspotClaim));
      if (consumer) {
        warnings.push(`Task "${otherTask.id}" consumes shared hotspot claim "${hotspotClaim}".`);
      }
    }
  }

  return [...new Set(warnings)];
}

function classifyGitPaths(paths) {
  const buckets = {
    product: [],
    data: [],
    verify: [],
    docs: [],
  };

  for (const filePath of paths) {
    if (isVisualSuitePath(filePath)) {
      buckets.verify.push(filePath);
      continue;
    }

    if (PATH_CLASSIFICATION.productPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
      buckets.product.push(filePath);
      continue;
    }

    if (PATH_CLASSIFICATION.dataPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
      buckets.data.push(filePath);
      continue;
    }

    if (PATH_CLASSIFICATION.verifyPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
      buckets.verify.push(filePath);
      continue;
    }

    if (
      PATH_CLASSIFICATION.docsFiles.includes(filePath) ||
      PATH_CLASSIFICATION.docsPrefixes.some((prefix) => pathStartsWith(filePath, prefix)) ||
      (COORDINATION_LABEL !== '.' && pathStartsWith(filePath, COORDINATION_LABEL))
    ) {
      buckets.docs.push(filePath);
      continue;
    }

    buckets.docs.push(filePath);
  }

  return {
    product: normalizePaths(buckets.product),
    data: normalizePaths(buckets.data),
    verify: normalizePaths(buckets.verify),
    docs: normalizePaths(buckets.docs),
  };
}

function inferDomainsFromPaths(paths) {
  const matched = new Set();

  for (const filePath of paths) {
    const loweredPath = filePath.toLowerCase();
    for (const rule of DOMAIN_RULES) {
      if (rule.keywords.some((keyword) => loweredPath.includes(keyword))) {
        matched.add(rule.name);
      }
    }
  }

  return [...matched];
}

async function initCommand() {
  await withMutationLock(async () => {
    ensureBaseFiles();
    const board = getBoard();
    await saveBoard(board);
  });
  console.log(`Initialized coordination workspace at ${COORDINATION_LABEL}.`);
}

async function claimCommand(positionals, options) {
  const [agentId, taskId] = positionals;
  const claimedPaths = parsePathsOption(options.paths);
  const issueKey = typeof options.issue === 'string' ? slugify(options.issue) : null;

  if (!agentId || !taskId) {
    throw new Error('Usage: claim <agent> <task-id> --paths <path[,path...]> [--summary <text>] [--force]');
  }

  if (!claimedPaths.length) {
    throw new Error('Claims require at least one path via --paths.');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const agent = getCommandAgent(board, agentId);

    if (agent.taskId && agent.taskId !== taskId) {
      throw new Error(`${agentId} is already assigned to "${agent.taskId}". Release or hand off that task first.`);
    }

    const conflicts = collectPathConflicts(board, agentId, taskId, claimedPaths);

    if (conflicts.length) {
      const summary = conflicts.map((conflict) => `${conflict.ownerId}/${conflict.taskId} (${conflict.path})`).join(', ');
      throw new Error(`Claim rejected because the requested paths overlap existing work: ${summary}`);
    }

    const candidateTask = getTask(board, taskId) ?? {
      id: taskId,
      ownerId: agentId,
      status: 'active',
      claimedPaths,
      issueKey,
      dependencies: [],
      verification: [],
      verificationLog: [],
      notes: [],
      rationale: '',
      effort: 'unknown',
      waitingOn: [],
      summary: typeof options.summary === 'string' ? options.summary : '',
    };
    candidateTask.claimedPaths = claimedPaths;
    candidateTask.issueKey = issueKey ?? candidateTask.issueKey ?? null;
    candidateTask.relevantDocs = inferRelevantDocs(claimedPaths, candidateTask.summary, candidateTask.verification);
    const riskWarnings = collectMergeRiskWarnings(
      candidateTask,
      board.tasks.filter((task) => task.id !== taskId && task.ownerId && ACTIVE_TASK_STATUSES.has(task.status))
    );

    if (riskWarnings.length && !options.force) {
      throw new Error(`Claim rejected because of shared-risk overlap: ${riskWarnings.join(' ')}`);
    }

    let task = getTask(board, taskId);
    const startedAt = nowIso();

    if (task?.status === PLANNED_TASK_STATUS) {
      const unmetDependencies = task.dependencies.filter((dependencyId) => {
        const dependencyTask = getTask(board, dependencyId);
        return dependencyTask && !TERMINAL_TASK_STATUSES.has(dependencyTask.status);
      });

      if (unmetDependencies.length && !options.force) {
        throw new Error(
          `Claim rejected because planned dependencies are still open: ${unmetDependencies.join(
            ', '
          )}. Re-run with --force if you intentionally want parallel work.`
        );
      }
    }

    if (!task) {
      task = {
        id: taskId,
        ownerId: agentId,
        lastOwnerId: agentId,
        status: 'active',
        summary: options.summary && typeof options.summary === 'string' ? options.summary : '',
        claimedPaths,
        suggestedOwnerId: null,
        dependencies: [],
        verification: [],
        verificationLog: [],
        rationale: '',
        effort: 'unknown',
        issueKey,
        waitingOn: [],
        relevantDocs: inferRelevantDocs(claimedPaths, options.summary && typeof options.summary === 'string' ? options.summary : '', []),
        docsReviewedAt: null,
        docsReviewedBy: null,
        createdAt: startedAt,
        updatedAt: startedAt,
        lastHandoff: null,
        notes: [],
      };
      board.tasks.push(task);
    } else {
      ensureTaskDefaults(task);
      task.ownerId = agentId;
      task.lastOwnerId = agentId;
      task.status = 'active';
      task.claimedPaths = claimedPaths;
      task.issueKey = issueKey ?? task.issueKey ?? null;
      task.waitingOn = [];
      if (typeof options.summary === 'string') {
        task.summary = options.summary;
      }
      task.relevantDocs = inferRelevantDocs(task.claimedPaths, task.summary, task.verification);
      task.updatedAt = startedAt;
    }

    task.verification = ensureVisualVerificationForTask(board, task);
    task.relevantDocs = inferRelevantDocs(task.claimedPaths, task.summary, task.verification);

    agent.status = 'active';
    agent.taskId = taskId;
    agent.updatedAt = startedAt;

    note(task, agentId, 'claim', `Claimed ${claimedPaths.join(', ')}.${task.summary ? ` Summary: ${task.summary}` : ''}`);
    appendJournalLine(`- ${startedAt} | ${agentId} claimed \`${taskId}\` on ${claimedPaths.join(', ')}.`);
    await saveBoard(board);
    console.log(`Claimed ${taskId} for ${agentId}.`);
    if (task.relevantDocs.length) {
      console.log(`Review docs before coding: ${task.relevantDocs.join(', ')}`);
    }
    if (hasVisualImpact(task.claimedPaths)) {
      console.log(
        `Visual suite required: ${getVisualVerificationChecksForTask(board, task).join(', ') || 'covered by dependent visual verification task'}.`
      );
    }
  });
}

async function reviewDocsCommand(positionals, options) {
  const [agentId, taskId] = positionals;
  const docsOverride = parsePathsOption(options.docs);
  const noteText = typeof options.note === 'string' ? options.note.trim() : '';

  if (!agentId || !taskId) {
    throw new Error('Usage: review-docs <agent> <task-id> [--docs <path[,path...]>] [--note <text>]');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot review docs for "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const relevantDocs = docsOverride.length ? docsOverride : inferRelevantDocs(task.claimedPaths, task.summary, task.verification);
    const timestamp = nowIso();

    task.relevantDocs = relevantDocs;
    task.docsReviewedAt = timestamp;
    task.docsReviewedBy = agentId;
    task.updatedAt = timestamp;
    note(task, agentId, 'docs-review', `Reviewed docs: ${relevantDocs.join(', ') || 'none recorded'}${noteText ? `. ${noteText}` : ''}`);

    agent.updatedAt = timestamp;
    appendJournalLine(`- ${timestamp} | ${agentId} reviewed docs for \`${taskId}\`: ${relevantDocs.join(', ') || 'none recorded'}.`);
    await saveBoard(board);
    console.log(`Docs review recorded for ${taskId}.`);
  });
}

async function progressCommand(positionals) {
  const [agentId, taskId, ...noteParts] = positionals;
  const body = noteParts.join(' ').trim();

  if (!agentId || !taskId || !body) {
    throw new Error('Usage: progress <agent> <task-id> <note>');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot log progress on "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    task.updatedAt = nowIso();
    note(task, agentId, 'progress', body);
    agent.updatedAt = task.updatedAt;
    appendJournalLine(`- ${task.updatedAt} | ${agentId} progress on \`${taskId}\`: ${body}`);
    await saveBoard(board);
    console.log(`Progress recorded on ${taskId}.`);
  });
}

async function waitCommand(positionals, options) {
  const [agentId, taskId] = positionals;
  const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
  const waitingOn = parsePathsOption(options.on);

  if (!agentId || !taskId || !reason || !waitingOn.length) {
    throw new Error('Usage: wait <agent> <task-id> --on <task-id[,task-id...]> --reason <text>');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot wait on "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    for (const dependencyId of waitingOn) {
      if (!getTask(board, dependencyId)) {
        throw new Error(`Cannot wait on missing task "${dependencyId}".`);
      }
    }

    const timestamp = nowIso();
    task.status = 'waiting';
    task.waitingOn = waitingOn;
    task.updatedAt = timestamp;
    note(task, agentId, 'waiting', `Waiting on ${waitingOn.join(', ')}. ${reason}`);

    agent.status = 'waiting';
    agent.taskId = taskId;
    agent.updatedAt = timestamp;

    const waitingInsights = buildWaitingInsights(board, task, timestamp);
    const sentAssistMessages = maybeQueueAssistMessages(board, task, timestamp);

    appendJournalLine(`- ${timestamp} | ${agentId} set \`${taskId}\` to waiting on ${waitingOn.join(', ')}: ${reason}`);
    await saveBoard(board);
    console.log(`Marked ${taskId} as waiting.`);
    if (waitingInsights.length) {
      console.log(
        waitingInsights
          .map((insight) => {
            const ownerLabel = insight.ownerId ?? 'unowned';
            return `- waiting on ${insight.dependencyTaskId}: ${ownerLabel} | ${insight.status} | updated ${insight.updatedAgo} | ${insight.reason}`;
          })
          .join('\n')
      );
    }
    if (sentAssistMessages.length) {
      console.log(
        sentAssistMessages
          .map((message) => `- assist ping sent to ${message.to} on ${message.taskId}: ${message.body}`)
          .join('\n')
      );
    }
  });
}

async function resumeCommand(positionals) {
  const [agentId, taskId, ...noteParts] = positionals;
  const body = noteParts.join(' ').trim();

  if (!agentId || !taskId || !body) {
    throw new Error('Usage: resume <agent> <task-id> <note>');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot resume "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const unresolved = task.waitingOn.filter((dependencyId) => {
      const dependencyTask = getTask(board, dependencyId);
      return dependencyTask && !TERMINAL_TASK_STATUSES.has(dependencyTask.status);
    });

    if (unresolved.length) {
      const details = unresolved
        .map((dependencyId) => {
          const insight = buildDependencyInsight(board, dependencyId);
          const ownerLabel = insight.ownerId ?? 'unowned';
          return `${dependencyId} (${ownerLabel}, ${insight.status}, updated ${insight.updatedAgo}: ${insight.reason})`;
        })
        .join('; ');
      throw new Error(`Cannot resume because these waited-on tasks are still open: ${details}.`);
    }

    const timestamp = nowIso();
    task.status = 'active';
    task.waitingOn = [];
    task.updatedAt = timestamp;
    note(task, agentId, 'resume', body);

    agent.status = 'active';
    agent.taskId = taskId;
    agent.updatedAt = timestamp;

    appendJournalLine(`- ${timestamp} | ${agentId} resumed \`${taskId}\`: ${body}`);
    await saveBoard(board);
    console.log(`Resumed ${taskId}.`);
  });
}

async function reserveResourceCommand(positionals, options) {
  const [agentId, resourceName, ...reasonParts] = positionals;
  const reason = reasonParts.join(' ').trim();
  const taskId = typeof options.task === 'string' ? options.task : null;

  if (!agentId || !resourceName || !reason) {
    throw new Error('Usage: reserve-resource <agent> <resource> <reason> [--task <task-id>]');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    getCommandAgent(board, agentId);

    if (taskId) {
      ensureTask(board, taskId);
    }

    const normalizedResource = slugify(resourceName);
    const existing = board.resources.find((resource) => resource.name === normalizedResource);
    if (existing && existing.ownerId !== agentId) {
      throw new Error(`Resource "${normalizedResource}" is already reserved by ${existing.ownerId}.`);
    }

    const timestamp = nowIso();
    if (existing) {
      existing.reason = reason;
      existing.taskId = taskId;
      existing.updatedAt = timestamp;
    } else {
      board.resources.push({
        name: normalizedResource,
        ownerId: agentId,
        taskId,
        reason,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    appendJournalLine(`- ${timestamp} | ${agentId} reserved resource \`${normalizedResource}\`${taskId ? ` for ${taskId}` : ''}: ${reason}`);
    await saveBoard(board);
    console.log(`Reserved resource ${normalizedResource}.`);
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

function areDependenciesSatisfied(board, task) {
  return task.dependencies.every((dependencyId) => {
    const dependencyTask = getTask(board, dependencyId);
    return dependencyTask && TERMINAL_TASK_STATUSES.has(dependencyTask.status);
  });
}

function buildHandoffBody(rawBody, options) {
  const directBody = rawBody.trim();

  if (directBody) {
    return directBody;
  }

  const summary = typeof options.summary === 'string' ? options.summary.trim() : '';
  const next = typeof options.next === 'string' ? options.next.trim() : '';
  const blocker = typeof options.blocker === 'string' ? options.blocker.trim() : '';

  if (!summary || !next) {
    throw new Error('Structured handoff requires both --summary and --next when no free-form note is provided.');
  }

  return `Summary: ${summary}\nNext: ${next}${blocker ? `\nBlocker: ${blocker}` : ''}`;
}

function scorePick(board, task, agentId) {
  let score = 0;

  if (task.suggestedOwnerId === agentId) {
    score += 10;
  }
  if (task.status === 'handoff') {
    score += 8;
  }
  if (task.status === 'review') {
    score += 6;
  }
  if (task.status === PLANNED_TASK_STATUS) {
    score += 4;
  }
  if (areDependenciesSatisfied(board, task)) {
    score += 5;
  }
  if (isTaskStale(task)) {
    score += 3;
  }

  return score;
}

function pickCommand(positionals) {
  const [agentId] = positionals;

  if (!agentId) {
    throw new Error('Usage: pick <agent>');
  }

  const board = getReadOnlyBoard();
  assertAgentSessionAvailable(agentId, currentCommandName, { cleanupStale: false });
  const agent = getAgent(board, agentId);

  if (agent.taskId) {
    console.log(`${agentId} is already assigned to ${agent.taskId}.`);
    return;
  }

  const candidates = board.tasks.filter((task) => {
    if (task.ownerId) {
      return false;
    }

    if (task.status === 'handoff' || task.status === 'review') {
      return true;
    }

    if (task.status === PLANNED_TASK_STATUS) {
      return areDependenciesSatisfied(board, task);
    }

    return false;
  });

  if (!candidates.length) {
    console.log(`No ready task found for ${agentId}.`);
    return;
  }

  const [bestTask] = [...candidates].sort((left, right) => {
    const scoreDelta = scorePick(board, right, agentId) - scorePick(board, left, agentId);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.id.localeCompare(right.id);
  });

  console.log(`Recommended for ${agentId}: ${bestTask.id}`);
  console.log(`Status: ${bestTask.status}`);
  console.log(`Summary: ${bestTask.summary || 'No summary'}`);
  console.log(`Paths: ${bestTask.claimedPaths.join(', ') || 'none'}`);
  console.log(`Dependencies: ${bestTask.dependencies.join(', ') || 'none'}`);
  console.log(`Verification: ${bestTask.verification.join(', ') || 'none'}`);
  console.log(`Docs: ${bestTask.relevantDocs.join(', ') || 'none suggested'}`);
  console.log(`Docs reviewed: ${bestTask.docsReviewedAt ? `yes (${bestTask.docsReviewedAt})` : 'no'}`);
}

async function setTaskStatusCommand(positionals, nextStatus) {
  const [agentId, taskId, ...noteParts] = positionals;
  const body = noteParts.join(' ').trim();

  if (!agentId || !taskId || !body) {
    throw new Error(`Usage: ${nextStatus} <agent> <task-id> <note>`);
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot mark "${taskId}" as ${nextStatus} because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const timestamp = nowIso();
    task.status = nextStatus;
    task.updatedAt = timestamp;
    note(task, agentId, nextStatus, body);

    agent.status = nextStatus;
    agent.taskId = taskId;
    agent.updatedAt = timestamp;

    appendJournalLine(`- ${timestamp} | ${agentId} marked \`${taskId}\` as ${nextStatus}: ${body}`);
    await saveBoard(board);
    console.log(`Marked ${taskId} as ${nextStatus}.`);
  });
}

async function messageCommand(positionals, options) {
  const [fromAgent, toAgent, ...bodyParts] = positionals;
  const body = bodyParts.join(' ').trim();

  if (!fromAgent || !toAgent || !body) {
    throw new Error('Usage: message <from-agent> <to-agent|all> <message> [--task <task-id>]');
  }

  if (toAgent !== 'all') {
    getAgent(getBoard(), toAgent);
  }

  assertAgentSessionAvailable(fromAgent);
  getAgent(getBoard(), fromAgent);

  await withMutationLock(async () => {
    const timestamp = nowIso();
    const message = {
      at: timestamp,
      from: fromAgent,
      to: toAgent,
      taskId: typeof options.task === 'string' ? options.task : null,
      body,
    };

    appendMessage(message);
    appendJournalLine(`- ${timestamp} | message ${fromAgent} -> ${toAgent}${message.taskId ? ` on \`${message.taskId}\`` : ''}: ${body}`);

    if (message.taskId) {
      const board = getBoard();
      const task = getTask(board, message.taskId);

      if (task) {
        task.updatedAt = timestamp;
        note(task, fromAgent, 'message', body, { to: toAgent });
        await saveBoard(board);
      }
    }

    console.log(`Message logged from ${fromAgent} to ${toAgent}.`);
  });
}

async function appNoteCommand(positionals, options) {
  const [agentId, rawCategory, ...bodyParts] = positionals;
  const category = String(rawCategory ?? '').trim().toLowerCase();
  const body = bodyParts.join(' ').trim();
  const paths = parsePathsOption(options.paths ?? options.path);
  const taskId = typeof options.task === 'string' && options.task.trim() ? options.task.trim() : null;

  if (!agentId || !category || !body) {
    throw new Error(`Usage: app-note <agent> <${[...APP_NOTE_CATEGORIES].join('|')}> <note> [--task <task-id>] [--paths <path[,path...]>]`);
  }

  if (!APP_NOTE_CATEGORIES.has(category)) {
    throw new Error(`Unknown app-note category "${category}". Expected one of: ${[...APP_NOTE_CATEGORIES].join(', ')}.`);
  }

  await withMutationLock(async () => {
    const board = getBoard();
    getCommandAgent(board, agentId);
    const timestamp = nowIso();

    if (taskId) {
      const task = ensureTask(board, taskId);
      task.updatedAt = timestamp;
      note(task, agentId, 'app-note', body, { category, paths });
    }

    appendAppNoteEntry({
      timestamp,
      agentId,
      category,
      taskId,
      paths,
      body,
    });
    appendJournalLine(
      `- ${timestamp} | ${agentId} recorded app note (${category})${taskId ? ` for \`${taskId}\`` : ''}${paths.length ? ` on ${paths.join(', ')}` : ''}: ${body}`
    );

    if (taskId) {
      await saveBoard(board);
    }

    console.log(`Recorded app note in ${APP_AGENT_NOTES_DOC}.`);
  });
}

function inboxCommand(positionals, options) {
  const [agentId] = positionals;
  const limit = Number.parseInt(String(options.limit ?? '10'), 10);

  if (!agentId) {
    throw new Error('Usage: inbox <agent> [--limit <count>]');
  }

  assertAgentSessionAvailable(agentId, currentCommandName, { cleanupStale: false });
  getAgent(getReadOnlyBoard(), agentId);

  const messages = readMessages()
    .filter((message) => message.to === 'all' || message.to === agentId || message.from === agentId)
    .slice(-Math.max(limit, 1));

  if (!messages.length) {
    console.log(`No messages for ${agentId}.`);
    return;
  }

  console.log(
    messages
      .map((message) => `- ${message.at} | ${message.from} -> ${message.to}${message.taskId ? ` [${message.taskId}]` : ''}: ${message.body}`)
      .join('\n')
  );
}

async function handoffCommand(positionals, options) {
  const [agentId, taskId, ...noteParts] = positionals;
  const body = buildHandoffBody(noteParts.join(' '), options);

  if (!agentId || !taskId) {
    throw new Error('Usage: handoff <agent> <task-id> <note> [--to <agent>]');
  }

  if (typeof options.to === 'string') {
    getAgent(getBoard(), options.to);
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot hand off "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const timestamp = nowIso();
    task.ownerId = null;
    task.status = 'handoff';
    task.updatedAt = timestamp;
    task.lastOwnerId = agentId;
    task.lastHandoff = {
      at: timestamp,
      from: agentId,
      to: typeof options.to === 'string' ? options.to : null,
      body,
    };
    note(task, agentId, 'handoff', body, { to: task.lastHandoff.to });

    agent.status = 'idle';
    agent.taskId = null;
    agent.updatedAt = timestamp;

    appendJournalLine(`- ${timestamp} | ${agentId} handed off \`${taskId}\`${task.lastHandoff.to ? ` to ${task.lastHandoff.to}` : ''}: ${body}`);
    await saveBoard(board);
    console.log(`Handoff recorded for ${taskId}.`);
  });
}

async function verifyCommand(positionals, options) {
  const [agentId, taskId, check, outcome] = positionals;
  const normalizedOutcome = (outcome ?? '').toLowerCase();
  const details = typeof options.details === 'string' ? options.details.trim() : '';

  if (!agentId || !taskId || !check || !normalizedOutcome) {
    throw new Error('Usage: verify <agent> <task-id> <check> <pass|fail> [--details <text>]');
  }

  if (!['pass', 'fail'].includes(normalizedOutcome)) {
    throw new Error('Verification outcome must be either "pass" or "fail".');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    getCommandAgent(board, agentId);

    task.updatedAt = nowIso();
    if (!task.verification.includes(check)) {
      task.verification.push(check);
    }
    task.verificationLog.push({
      at: task.updatedAt,
      agent: agentId,
      check,
      outcome: normalizedOutcome,
      details,
    });

    note(task, agentId, 'verify', `${check}: ${normalizedOutcome}${details ? ` (${details})` : ''}`);
    appendJournalLine(`- ${task.updatedAt} | ${agentId} verified \`${taskId}\` with ${check}: ${normalizedOutcome}${details ? ` | ${details}` : ''}`);
    await saveBoard(board);
    console.log(`Recorded verification for ${taskId}.`);
  });
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
        existingResource.updatedAt = timestamp;
      } else {
        board.resources.push({
          name: resource,
          ownerId: agentId,
          taskId,
          reason: `Incident ${incidentKey}: ${summary}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
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

async function releaseCommand(positionals, options) {
  const [agentId, taskId] = positionals;

  if (!agentId || !taskId) {
    throw new Error('Usage: release <agent> <task-id> [--note <text>]');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot release "${taskId}" because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const timestamp = nowIso();
    task.ownerId = null;
    task.status = 'released';
    task.updatedAt = timestamp;
    task.lastOwnerId = agentId;

    if (typeof options.note === 'string' && options.note.trim()) {
      note(task, agentId, 'release', options.note.trim());
    }

    agent.status = 'idle';
    agent.taskId = null;
    agent.updatedAt = timestamp;

    appendJournalLine(`- ${timestamp} | ${agentId} released \`${taskId}\`${options.note ? `: ${options.note}` : ''}`);
    await saveBoard(board);
    console.log(`Released ${taskId}.`);
  });
}

async function doneCommand(positionals) {
  const [agentId, taskId, ...noteParts] = positionals;
  const body = noteParts.join(' ').trim();

  if (!agentId || !taskId || !body) {
    throw new Error('Usage: done <agent> <task-id> <note>');
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const task = ensureTask(board, taskId);
    const agent = getCommandAgent(board, agentId);

    if (task.ownerId !== agentId) {
      throw new Error(`${agentId} cannot mark "${taskId}" done because it is currently owned by ${task.ownerId ?? 'nobody'}.`);
    }

    const missingVisualChecks = getMissingVisualPassingChecks(board, task);
    if (missingVisualChecks.length) {
      throw new Error(
        `Cannot mark "${taskId}" done because UI/visual changes still need passing visual verification: ${missingVisualChecks.join(
          ', '
        )}. Update routes/snapshots when intentional, then record the visual pass.`
      );
    }

    const timestamp = nowIso();
    task.ownerId = null;
    task.status = 'done';
    task.updatedAt = timestamp;
    task.lastOwnerId = agentId;
    note(task, agentId, 'done', body);

    agent.status = 'idle';
    agent.taskId = null;
    agent.updatedAt = timestamp;

    appendJournalLine(`- ${timestamp} | ${agentId} completed \`${taskId}\`: ${body}`);
    await saveBoard(board);
    console.log(`Marked ${taskId} done.`);
    if (APP_AGENT_NOTES_DOC) {
      console.log(
        `If this exposed reusable errors, inconsistencies, or behavior changes, record them with: ${cliRunLabel(
          ` -- app-note ${agentId} change "..." --task ${taskId}`
        )}`
      );
    }
  });
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function mergePaths(...pathGroups) {
  return normalizePaths(pathGroups.flat());
}

function getSuggestedAgent(index) {
  return AGENT_IDS[index] ?? AGENT_IDS[AGENT_IDS.length - 1] ?? DEFAULT_AGENT_IDS[index] ?? DEFAULT_AGENT_IDS[0];
}

function hasAnyToken(tokens, keywords) {
  return keywords.some((keyword) => tokens.includes(keyword));
}

function collectExplicitMatchedDomains(goal) {
  const loweredGoal = goal.toLowerCase();
  return DOMAIN_RULES.filter((rule) => rule.keywords.some((keyword) => loweredGoal.includes(keyword)));
}

function collectMatchedDomains(goal) {
  const matched = collectExplicitMatchedDomains(goal);
  if (matched.length) {
    return matched;
  }

  const defaultDomains = DOMAIN_RULES.filter((rule) => DEFAULT_DOMAIN_NAMES.includes(rule.name));
  return defaultDomains.length ? defaultDomains : DOMAIN_RULES.slice(0, 1);
}

function buildPlanSizing({ goal, gitBuckets, effectiveDomains, explicitDomains, complexityScore }) {
  const tokens = tokenizeForDocs(goal);
  const dataSignal = Boolean(gitBuckets.data.length) || hasAnyToken(tokens, PLANNING_AGENT_SIZING.dataKeywords);
  const verifySignal = Boolean(gitBuckets.verify.length) || hasAnyToken(tokens, PLANNING_AGENT_SIZING.verifyKeywords);
  const docsSignal = Boolean(gitBuckets.docs.length) || hasAnyToken(tokens, PLANNING_AGENT_SIZING.docsKeywords);
  const productKeywordSignal = Boolean(gitBuckets.product.length) || hasAnyToken(tokens, PLANNING_AGENT_SIZING.productKeywords);
  const explicitNonDocsDomain = explicitDomains.some((rule) => rule.name !== 'docs');
  const docsOnly = docsSignal && !dataSignal && !verifySignal && !productKeywordSignal && !explicitNonDocsDomain;
  const dataOnly = dataSignal && !docsSignal && !verifySignal && !productKeywordSignal && !explicitDomains.some((rule) => rule.scopes.product.length);
  const verifyOnly = verifySignal && !docsSignal && !dataSignal && !productKeywordSignal && !explicitDomains.some((rule) => rule.scopes.product.length);
  const productSignal = !docsOnly && !dataOnly && !verifyOnly;
  const mediumComplexity = complexityScore >= PLANNING_AGENT_SIZING.mediumComplexityScore;
  const largeComplexity = complexityScore >= PLANNING_AGENT_SIZING.largeComplexityScore;
  const visualConfigured = VISUAL_REQUIRED_CHECKS.length > 0 || VISUAL_SUITE_UPDATE_CHECKS.length > 0;
  const lanes = [];
  const reasons = [];

  if (docsOnly) {
    lanes.push('docs');
    reasons.push('docs-only goal');
  } else if (verifyOnly) {
    lanes.push('verify');
    reasons.push('verification-only goal');
  } else if (dataOnly) {
    lanes.push('data');
    reasons.push('data-only goal');
  } else {
    if (productSignal) {
      lanes.push('product');
      reasons.push(productKeywordSignal ? 'product/UI signal' : 'default implementation lane');
    }

    if (dataSignal) {
      lanes.push('data');
      reasons.push('data/backend signal');
    }

    if (verifySignal || (visualConfigured && productSignal && (dataSignal || mediumComplexity))) {
      lanes.push('verify');
      reasons.push(verifySignal ? 'verification signal' : 'medium UI/data complexity');
    }

    if (docsSignal || largeComplexity) {
      lanes.push('docs');
      reasons.push(docsSignal ? 'documentation signal' : 'large complexity needs docs cleanup');
    }
  }

  const dedupedLanes = [...new Set(lanes)];
  const maxAgents = Math.max(1, Math.min(PLANNING_AGENT_SIZING.maxAgents, AGENT_IDS.length || DEFAULT_AGENT_IDS.length));
  const minAgents = Math.max(1, Math.min(PLANNING_AGENT_SIZING.minAgents, maxAgents));
  const cappedLanes = dedupedLanes.slice(0, maxAgents);

  if (cappedLanes.length < minAgents) {
    for (const lane of ['product', 'data', 'verify', 'docs']) {
      if (cappedLanes.length >= minAgents) {
        break;
      }
      if (!cappedLanes.includes(lane)) {
        cappedLanes.push(lane);
      }
    }
  }

  return {
    lanes: cappedLanes,
    agentCount: cappedLanes.length,
    availableAgentCount: AGENT_IDS.length,
    reason: reasons.join('; ') || 'minimal default split',
    complexityScore,
  };
}

function buildPlanProposal(goal, options = {}) {
  const gitState = options.gitChanges ? getGitChangedPaths() : { available: false, paths: [] };
  const pathDomains = gitState.paths.length ? inferDomainsFromPaths(gitState.paths) : [];
  const explicitKeywordDomains = collectExplicitMatchedDomains(goal);
  const keywordDomains = explicitKeywordDomains.length ? explicitKeywordDomains : collectMatchedDomains(goal);
  const combinedDomains = [...new Set([...pathDomains, ...keywordDomains])];
  const matchedDomains = DOMAIN_RULES.filter((rule) => combinedDomains.includes(rule.name));
  const effectiveDomains = matchedDomains.length ? matchedDomains : keywordDomains;
  const createdAt = nowIso();
  const goalSlug = slugify(goal) || 'work';
  const planId = `plan-${goalSlug}-${Date.now()}`;

  const gitBuckets = classifyGitPaths(gitState.paths);

  const productPaths = mergePaths(
    gitBuckets.product,
    effectiveDomains.flatMap((rule) => rule.scopes.product),
    PLANNING_PRODUCT_FALLBACK_PATHS
  );
  const dataPaths = mergePaths(
    gitBuckets.data,
    effectiveDomains.flatMap((rule) => rule.scopes.data),
    PLANNING_DATA_FALLBACK_PATHS
  );
  const verifyPaths = mergePaths(
    gitBuckets.verify,
    effectiveDomains.flatMap((rule) => rule.scopes.verify),
    VISUAL_SUITE_DEFAULT_PATHS,
    PLANNING_VERIFY_FALLBACK_PATHS
  );
  const docsPaths = mergePaths(
    gitBuckets.docs,
    effectiveDomains.flatMap((rule) => rule.scopes.docs),
    PLANNING_DOCS_FALLBACK_PATHS,
    [APP_AGENT_NOTES_DOC, COORDINATION_README_PATH]
  );

  const focusLabel = effectiveDomains.map((rule) => rule.name).join(', ');
  const gitSummary = gitState.available
    ? gitState.paths.length
      ? `Git changed paths influenced the split (${gitState.paths.length} file(s)).`
      : 'Git was available, but no changed paths were detected.'
    : 'Git changed paths were not available, so the planner used repo heuristics only.';
  const complexityScore = goal.toLowerCase().split(/\s+/).filter(Boolean).length + effectiveDomains.length * 2 + gitState.paths.length;
  const productEffort = complexityScore >= 12 ? 'large' : 'medium';
  const dataEffort = complexityScore >= 14 ? 'large' : 'medium';
  const verifyEffort = complexityScore >= 10 ? 'medium' : 'small';
  const docsEffort = gitBuckets.docs.length > 3 ? 'medium' : 'small';
  const sizing = buildPlanSizing({
    goal,
    gitBuckets,
    effectiveDomains,
    explicitDomains: explicitKeywordDomains,
    complexityScore,
  });

  const taskByLane = {
    product: {
      id: `${goalSlug}-product`,
      ownerId: null,
      lastOwnerId: null,
      suggestedOwnerId: getSuggestedAgent(0),
      status: PLANNED_TASK_STATUS,
      summary: `Product surface changes for: ${goal}`,
      claimedPaths: productPaths,
      dependencies: [],
      verification: ['typecheck'],
      verificationLog: [],
      relevantDocs: inferRelevantDocs(productPaths, `Product surface changes for: ${goal}`, ['typecheck']),
      docsReviewedAt: null,
      docsReviewedBy: null,
      rationale: `UI-facing work was grouped around ${focusLabel}. ${gitSummary}`,
      effort: productEffort,
      createdAt,
      updatedAt: createdAt,
      lastHandoff: null,
      planId,
      notes: [
        {
          at: createdAt,
          agent: 'planner',
          kind: 'plan',
          body: `Planner split generated from goal. Focus domains: ${focusLabel}. ${gitSummary}`,
        },
      ],
    },
    data: {
      id: `${goalSlug}-data`,
      ownerId: null,
      lastOwnerId: null,
      suggestedOwnerId: getSuggestedAgent(1),
      status: PLANNED_TASK_STATUS,
      summary: `Data, state, and integration work for: ${goal}`,
      claimedPaths: dataPaths,
      dependencies: [`${goalSlug}-product`],
      verification: ['typecheck'],
      verificationLog: [],
      relevantDocs: inferRelevantDocs(dataPaths, `Data, state, and integration work for: ${goal}`, ['typecheck']),
      docsReviewedAt: null,
      docsReviewedBy: null,
      rationale: `State and API files were isolated so contract changes stay coordinated in one lane before verification starts. ${gitSummary}`,
      effort: dataEffort,
      createdAt,
      updatedAt: createdAt,
      lastHandoff: null,
      planId,
      notes: [
        {
          at: createdAt,
          agent: 'planner',
          kind: 'plan',
          body: `Planner assigned data-facing scope. Focus domains: ${focusLabel}. ${gitSummary}`,
        },
      ],
    },
    verify: {
      id: `${goalSlug}-verify`,
      ownerId: null,
      lastOwnerId: null,
      suggestedOwnerId: getSuggestedAgent(2),
      status: PLANNED_TASK_STATUS,
      summary: `Verification and visual coverage for: ${goal}`,
      claimedPaths: verifyPaths,
      dependencies: [`${goalSlug}-product`, `${goalSlug}-data`],
      verification: [...VISUAL_SUITE_UPDATE_CHECKS, 'typecheck'],
      verificationLog: [],
      relevantDocs: inferRelevantDocs(verifyPaths, `Verification and visual coverage for: ${goal}`, [...VISUAL_SUITE_UPDATE_CHECKS, 'typecheck']),
      docsReviewedAt: null,
      docsReviewedBy: null,
      rationale: `Visual routes, fixtures, and snapshots were grouped separately so intentional UI changes refresh the visual suite before final verification. ${gitSummary}`,
      effort: verifyEffort,
      createdAt,
      updatedAt: createdAt,
      lastHandoff: null,
      planId,
      notes: [
        {
          at: createdAt,
          agent: 'planner',
          kind: 'plan',
          body: `Planner assigned verification scope. Focus domains: ${focusLabel}. ${gitSummary}`,
        },
      ],
    },
    docs: {
      id: `${goalSlug}-docs`,
      ownerId: null,
      lastOwnerId: null,
      suggestedOwnerId: getSuggestedAgent(3),
      status: PLANNED_TASK_STATUS,
      summary: `Documentation and coordination cleanup for: ${goal}`,
      claimedPaths: docsPaths,
      dependencies: [`${goalSlug}-product`, `${goalSlug}-data`],
      verification: ['docs-review'],
      verificationLog: [],
      relevantDocs: inferRelevantDocs(docsPaths, `Documentation and coordination cleanup for: ${goal}`, ['docs-review']),
      docsReviewedAt: null,
      docsReviewedBy: null,
      rationale: `Docs and coordination updates are split out so delivery notes can track the final merged behavior rather than drafts. ${gitSummary}`,
      effort: docsEffort,
      createdAt,
      updatedAt: createdAt,
      lastHandoff: null,
      planId,
      notes: [
        {
          at: createdAt,
          agent: 'planner',
          kind: 'plan',
          body: `Planner assigned documentation and wrap-up scope. Focus domains: ${focusLabel}. ${gitSummary}`,
        },
      ],
    },
  };

  const tasks = sizing.lanes
    .map((lane) => taskByLane[lane])
    .filter(Boolean);
  const selectedTaskIds = new Set(tasks.map((task) => task.id));

  for (const [index, task] of tasks.entries()) {
    task.suggestedOwnerId = getSuggestedAgent(index);
    task.dependencies = task.dependencies.filter((dependencyId) => selectedTaskIds.has(dependencyId));
  }

  return {
    id: planId,
    goal,
    createdAt,
    matchedDomains: effectiveDomains.map((rule) => rule.name),
    gitAvailable: gitState.available,
    gitChangedPaths: gitState.paths,
    agentCount: sizing.agentCount,
    availableAgentCount: sizing.availableAgentCount,
    sizingReason: sizing.reason,
    complexityScore: sizing.complexityScore,
    tasks,
  };
}

function renderPlan(plan) {
  const lines = [];
  lines.push(`Plan: ${plan.id}`);
  lines.push(`Goal: ${plan.goal}`);
  lines.push(`Domains: ${plan.matchedDomains.join(', ')}`);
  lines.push(`Git changed paths: ${plan.gitAvailable ? (plan.gitChangedPaths.length ? plan.gitChangedPaths.join(', ') : 'none detected') : 'unavailable'}`);
  lines.push(`Suggested agents: ${plan.agentCount ?? plan.tasks.length}/${plan.availableAgentCount ?? AGENT_IDS.length} | complexity ${plan.complexityScore ?? 'unknown'} | ${plan.sizingReason ?? 'default split'}`);
  lines.push('');

  for (const task of plan.tasks) {
    lines.push(`- ${task.suggestedOwnerId} -> ${task.id}`);
    lines.push(`  Summary: ${task.summary}`);
    lines.push(`  Paths: ${task.claimedPaths.join(', ') || 'none'}`);
    lines.push(`  Depends on: ${task.dependencies.join(', ') || 'none'}`);
    lines.push(`  Effort: ${task.effort}`);
    lines.push(`  Verify: ${task.verification.join(', ') || 'none'}`);
    lines.push(`  Docs: ${task.relevantDocs.join(', ') || 'none suggested'}`);
    lines.push(`  Why: ${task.rationale}`);
  }

  return lines.join('\n');
}

async function planCommand(positionals, options) {
  const goal = positionals.join(' ').trim();

  if (!goal) {
    throw new Error('Usage: plan <goal> [--apply] [--git-changes]');
  }

  const plan = buildPlanProposal(goal, {
    gitChanges: Boolean(options['git-changes']),
  });

  if (!options.apply) {
    console.log(renderPlan(plan));
    console.log('\nRun the same command with --apply to persist these planned tasks.');
    return;
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const plannedTaskIds = new Set(plan.tasks.map((task) => task.id));
    const unsafeCollisions = board.tasks.filter(
      (task) => plannedTaskIds.has(task.id) && (task.status !== PLANNED_TASK_STATUS || task.ownerId)
    );

    if (unsafeCollisions.length) {
      const summary = unsafeCollisions.map((task) => `${task.id} (${task.status}${task.ownerId ? `, owner ${task.ownerId}` : ''})`).join(', ');
      throw new Error(
        `Plan apply refused because task id(s) already exist outside an unowned planned state: ${summary}. Use a more specific goal or manually release/rename the existing task first.`
      );
    }

    board.tasks = board.tasks.filter((task) => !(plannedTaskIds.has(task.id) && task.status === PLANNED_TASK_STATUS && !task.ownerId));
    board.plans = board.plans.filter((entry) => entry.id !== plan.id);
    board.plans.push({
      id: plan.id,
      goal: plan.goal,
      createdAt: plan.createdAt,
      matchedDomains: plan.matchedDomains,
      gitAvailable: plan.gitAvailable,
      gitChangedPaths: plan.gitChangedPaths,
      agentCount: plan.agentCount,
      availableAgentCount: plan.availableAgentCount,
      sizingReason: plan.sizingReason,
      complexityScore: plan.complexityScore,
    });
    board.tasks.push(...plan.tasks);

    appendJournalLine(`- ${plan.createdAt} | planner created \`${plan.id}\` for goal: ${plan.goal}`);
    await saveBoard(board);
    console.log(renderPlan(plan));
    console.log('\nPlanned tasks saved. Agents can now claim these task ids directly.');
  });
}

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

    if (!VALID_TASK_STATUSES.has(task.status)) {
      findings.push(`Task "${task.id}" has unknown status "${task.status}".`);
    }

    if (ACTIVE_TASK_STATUSES.has(task.status) && !task.ownerId) {
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
      findings.push(`Task "${task.id}" is stale; no update for at least ${STALE_TASK_HOURS} hours.`);
    }

    if (task.status === 'review' && !task.verification.length) {
      findings.push(`Task "${task.id}" is review but has no verification intent recorded.`);
    }

    if (hasVisualImpact(task.claimedPaths) && !hasVisualCheck(task.verification) && !hasVisualVerificationCompanion(board, task)) {
      findings.push(
        `Task "${task.id}" touches UI or visual-suite paths but has no visual verification intent. Add ${VISUAL_REQUIRED_CHECKS.join(
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

    if (DOC_REVIEW_REQUIRED_STATUSES.has(task.status) && task.relevantDocs.length && !task.docsReviewedAt) {
      findings.push(`Task "${task.id}" has relevant docs but no recorded docs review: ${task.relevantDocs.join(', ')}.`);
    }
  }

  const agentIds = new Set();
  for (const agent of board.agents) {
    if (!agent.id || typeof agent.id !== 'string') {
      findings.push('An agent is missing a string id.');
      continue;
    }

    if (agentIds.has(agent.id)) {
      findings.push(`Agent id "${agent.id}" is duplicated.`);
    }
    agentIds.add(agent.id);

    if (!AGENT_IDS.includes(agent.id)) {
      findings.push(`Agent "${agent.id}" is not a supported slot. Expected one of: ${AGENT_IDS.join(', ')}.`);
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

  const claimedTasks = board.tasks.filter((task) => task.ownerId && ACTIVE_TASK_STATUSES.has(task.status));
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
  for (const [issueKey, taskIds] of activeIssueKeys.entries()) {
    if (taskIds.length > 1) {
      findings.push(`Multiple active tasks share issue key "${issueKey}": ${taskIds.join(', ')}.`);
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
      findings.push(`Resource "${resource.name}" is stale; no update for at least ${RESOURCE_STALE_HOURS} hours.`);
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

    if (!VALID_ACCESS_STATUSES.has(request.status)) {
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

  const openIncidentKeys = new Set();
  for (const incident of board.incidents) {
    if (!incident.key || !incident.ownerId || !incident.status) {
      findings.push('An incident is missing key, owner, or status.');
      continue;
    }
    if (!VALID_INCIDENT_STATUSES.has(incident.status)) {
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
      findings.push(`Incident "${incident.key}" is stale; no update for at least ${STALE_INCIDENT_HOURS} hours.`);
    }
  }

  return findings;
}

function gitignorePatternMatches(pattern, normalizedPath) {
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (!normalizedPattern) {
    return false;
  }
  if (!/[?*[\]]/.test(normalizedPattern)) {
    return normalizedPattern === normalizedPath || normalizedPath.startsWith(`${normalizedPattern}/`);
  }
  const globstarToken = '\0GLOBSTAR\0';
  const escaped = normalizedPattern
    .replace(/\*\*/g, globstarToken)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll(globstarToken, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${escaped}(?:/.*)?$`);
  return regex.test(normalizedPath);
}

function isRepoLocalPathIgnored(relativePath) {
  const normalized = normalizePath(relativePath);
  if (!normalized || normalized === '.') {
    return false;
  }

  if (execGit(['check-ignore', '--quiet', normalized]) !== null) {
    return true;
  }

  const gitignorePath = path.join(ROOT, '.gitignore');
  if (!fileExists(gitignorePath)) {
    return false;
  }

  return fs
    .readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .some((line) => gitignorePatternMatches(line, normalized));
}

function getPackageScripts() {
  const packagePath = path.join(ROOT, 'package.json');
  if (!fileExists(packagePath)) {
    return null;
  }

  const packageJson = readJson(packagePath, null);
  return packageJson && typeof packageJson === 'object' && packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : null;
}

function addPathCheck({ findings, warnings, passes }, label, relativePath, options = {}) {
  const required = options.required !== false;
  const normalized = normalizePath(relativePath);

  if (!normalized) {
    if (required) {
      findings.push(`${label} is not configured.`);
    }
    return;
  }

  if (fileExists(path.join(ROOT, normalized))) {
    passes.push(`${label}: ${normalized}`);
    return;
  }

  const message = `${label} does not exist: ${normalized}`;
  if (required) {
    findings.push(message);
  } else {
    warnings.push(message);
  }
}

function doctorCommand() {
  const findings = [];
  const warnings = [];
  const passes = [];
  const check = { findings, warnings, passes };

  if (fileExists(AGENT_CONFIG_PATH)) {
    passes.push(`Config loaded: ${normalizePath(path.relative(ROOT, AGENT_CONFIG_PATH))}`);
  } else {
    warnings.push('No agent-coordination.config.json found; using built-in generic defaults.');
  }

  if (AGENT_IDS.length) {
    passes.push(`Agent slots: ${AGENT_IDS.join(', ')}`);
  } else {
    findings.push('No agent slots are configured.');
  }

  addPathCheck(check, 'Coordinator script', normalizePath(path.relative(ROOT, COORDINATOR_SCRIPT_PATH)));
  addPathCheck(check, 'Watch loop script', normalizePath(path.relative(ROOT, WATCH_LOOP_SCRIPT_PATH)));

  for (const docsRoot of DOCS_ROOTS) {
    addPathCheck(check, 'Docs root', docsRoot);
  }

  addPathCheck(check, 'App notes doc', APP_AGENT_NOTES_DOC, { required: Boolean(APP_AGENT_NOTES_DOC) });

  if (VISUAL_WORKFLOW_DOC) {
    addPathCheck(check, 'Visual workflow doc', VISUAL_WORKFLOW_DOC, {
      required: VISUAL_REQUIRED_CHECKS.length > 0 || VISUAL_SUITE_UPDATE_CHECKS.length > 0,
    });
  }

  const packageScripts = getPackageScripts();
  if (!packageScripts) {
    findings.push('package.json scripts could not be read.');
  } else {
    const expectedScripts = [
      'agents',
      'agents:init',
      'agents:status',
      'agents:validate',
      'agents:doctor',
      'agents2',
      'agents2:init',
      'agents2:status',
      'agents2:validate',
      'agents2:doctor',
    ];

    for (const scriptName of expectedScripts) {
      if (typeof packageScripts[scriptName] === 'string') {
        passes.push(`Package script: ${scriptName}`);
      } else {
        findings.push(`Missing package script: ${scriptName}`);
      }
    }

    for (const checkName of [...new Set([...VISUAL_REQUIRED_CHECKS, ...VISUAL_SUITE_UPDATE_CHECKS])]) {
      const scriptName = checkName.split(/\s+/)[0];
      if (scriptName && !packageScripts[scriptName]) {
        warnings.push(`Configured verification check has no matching npm script: ${scriptName}`);
      }
    }
  }

  if (COORDINATION_LABEL !== '.' && isRepoLocalPathIgnored(COORDINATION_LABEL)) {
    passes.push(`Runtime workspace is ignored by git: ${COORDINATION_LABEL}`);
  } else if (COORDINATION_LABEL !== '.') {
    findings.push(`Runtime workspace is not ignored by git: ${COORDINATION_LABEL}`);
  }

  if (!DOMAIN_RULES.length) {
    findings.push('No domain rules are configured.');
  } else {
    passes.push(`Domain rules: ${DOMAIN_RULES.map((rule) => rule.name).join(', ')}`);
  }

  const board = getBoardSnapshot();
  if (board) {
    const boardFindings = validateBoard(board, {
      liveHeartbeats: readAgentHeartbeats(nowIso(), { cleanupStale: false }),
    });

    if (boardFindings.length) {
      warnings.push(...boardFindings.map((finding) => `Board: ${finding}`));
    } else {
      passes.push('Current board snapshot is valid.');
    }
  } else {
    warnings.push(`No board exists yet at ${normalizePath(path.relative(ROOT, BOARD_PATH))}. Run ${cliRunLabel(':init')} to initialize.`);
  }

  const lines = ['Agent coordination doctor', ''];
  lines.push(`Project: ${PROJECT_NAME}`);
  lines.push(`Workspace: ${COORDINATION_LABEL}`);
  lines.push(`Config: ${fileExists(AGENT_CONFIG_PATH) ? normalizePath(path.relative(ROOT, AGENT_CONFIG_PATH)) : 'built-in generic defaults'}`);
  lines.push('');
  lines.push(`Passes (${passes.length}):`);
  lines.push(...(passes.length ? passes.map((entry) => `- ${entry}`) : ['- none']));
  lines.push('');
  lines.push(`Warnings (${warnings.length}):`);
  lines.push(...(warnings.length ? warnings.map((entry) => `- ${entry}`) : ['- none']));
  lines.push('');
  lines.push(`Findings (${findings.length}):`);
  lines.push(...(findings.length ? findings.map((entry) => `- ${entry}`) : ['- none']));

  console.log(lines.join('\n'));
  process.exitCode = findings.length ? 1 : 0;
}

function buildRecoveryReport(board, referenceIso = nowIso(), options = {}) {
  const liveHeartbeats = options.liveHeartbeats ?? readAgentHeartbeats(referenceIso, { cleanupStale: options.cleanupStale !== false });
  const staleTasks = board.tasks.filter((task) => isTaskStale(task, referenceIso) && !hasLiveAgentHeartbeat(task.ownerId, liveHeartbeats));
  const staleResources = board.resources.filter(
    (resource) => isResourceStale(resource, referenceIso) && !hasLiveAgentHeartbeat(resource.ownerId, liveHeartbeats)
  );
  const staleIncidents = board.incidents.filter(
    (incident) => isIncidentStale(incident, referenceIso) && !hasLiveAgentHeartbeat(incident.ownerId, liveHeartbeats)
  );

  return {
    staleTasks,
    staleResources,
    staleIncidents,
    liveHeartbeats,
  };
}

function renderRecoveryReport(report) {
  const lines = [];
  lines.push('Recovery report');
  lines.push('');
  lines.push('Stale tasks:');
  lines.push(
    report.staleTasks.length
      ? report.staleTasks.map((task) => `- ${task.id}: ${task.status}${task.ownerId ? ` | owner ${task.ownerId}` : ''}`).join('\n')
      : '- none'
  );
  lines.push('');
  lines.push('Stale resources:');
  lines.push(
    report.staleResources.length
      ? report.staleResources.map((resource) => `- ${resource.name}: ${resource.ownerId}${resource.taskId ? ` (${resource.taskId})` : ''}`).join('\n')
      : '- none'
  );
  lines.push('');
  lines.push('Stale incidents:');
  lines.push(
    report.staleIncidents.length
      ? report.staleIncidents.map((incident) => `- ${incident.key}: owner ${incident.ownerId}`).join('\n')
      : '- none'
  );

  return lines.join('\n');
}

function applyRecovery(board, report, timestamp = nowIso()) {
  for (const task of report.staleTasks) {
    const ownerId = task.ownerId;
    task.ownerId = null;
    task.status = 'handoff';
    task.lastOwnerId = ownerId ?? task.lastOwnerId ?? null;
    task.updatedAt = timestamp;
    task.waitingOn = [];
    task.lastHandoff = {
      at: timestamp,
      from: ownerId ?? 'recovery',
      to: null,
      body: 'Recovered after stale session or unexpected disconnect. Resume from task notes and verification log.',
    };
    note(task, 'recovery', 'recover', 'Task moved to handoff after stale session or unexpected disconnect.');

    if (ownerId) {
      const ownerAgent = board.agents.find((agent) => agent.id === ownerId);
      if (ownerAgent && ownerAgent.taskId === task.id) {
        ownerAgent.status = 'idle';
        ownerAgent.taskId = null;
        ownerAgent.updatedAt = timestamp;
      }
    }
  }

  if (report.staleResources.length) {
    board.resources = board.resources.filter((resource) => !report.staleResources.some((stale) => stale.name === resource.name));
  }

  for (const incident of report.staleIncidents) {
    incident.status = 'abandoned';
    incident.resolution = 'Marked abandoned during recovery after stale session or unexpected disconnect.';
    incident.updatedAt = timestamp;
  }
}

async function autoHealIfNeeded(commandName, options = {}) {
  if (AUTO_HEAL_EXCLUDED_COMMANDS.has(commandName) || isReadOnlyCommand(commandName, options)) {
    return null;
  }

  return withMutationLock(async () => {
    const board = getBoard();
    const report = buildRecoveryReport(board);
    const total = report.staleTasks.length + report.staleResources.length + report.staleIncidents.length;

    if (!total) {
      return null;
    }

    const timestamp = nowIso();
    applyRecovery(board, report, timestamp);
    appendJournalLine(
      `- ${timestamp} | auto-heal applied before \`${commandName}\`: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
    );
    await saveBoard(board);

    return {
      commandName,
      staleTasks: report.staleTasks.length,
      staleResources: report.staleResources.length,
      staleIncidents: report.staleIncidents.length,
    };
  });
}

function parseIntervalMs(value, fallbackMs, usage) {
  const intervalMs = Number.parseInt(String(value ?? fallbackMs), 10);
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_AGENT_HEARTBEAT_INTERVAL_MS) {
    throw new Error(`${usage} with interval >= ${MIN_AGENT_HEARTBEAT_INTERVAL_MS}.`);
  }
  return intervalMs;
}

function buildAgentHeartbeatRecord(agentId, intervalMs, existingHeartbeat = null, command = 'heartbeat') {
  const timestamp = nowIso();
  const board = getBoardSnapshot();
  const agent = board?.agents.find((entry) => entry.id === agentId) ?? null;
  const task = agent?.taskId ? getTask(board, agent.taskId) : null;

  return {
    agentId,
    pid: process.pid,
    terminalId: TERMINAL_ID,
    startedAt: existingHeartbeat?.pid === process.pid && existingHeartbeat?.startedAt ? existingHeartbeat.startedAt : timestamp,
    lastHeartbeatAt: timestamp,
    intervalMs,
    taskId: agent?.taskId ?? null,
    taskStatus: task?.status ?? null,
    boardUpdatedAt: board?.updatedAt ?? null,
    workspace: COORDINATION_LABEL,
    command,
  };
}

function heartbeatStatusCommand(positionals) {
  const [agentId] = positionals;

  if (agentId) {
    getAgent(getBoard(), agentId);
  }

  const heartbeats = readAgentHeartbeats(nowIso(), { cleanupStale: false });
  if (agentId) {
    const heartbeat = heartbeats.get(agentId);
    console.log(
      heartbeat
        ? renderHeartbeatLine(heartbeat)
        : `No live heartbeat for ${agentId}.${TERMINAL_ID ? ` Current terminal: ${TERMINAL_ID}.` : ''}`
    );
    return;
  }

  if (!heartbeats.size) {
    console.log(`No live heartbeats.${TERMINAL_ID ? ` Current terminal: ${TERMINAL_ID}.` : ''}`);
    return;
  }

  const lines = [];
  if (TERMINAL_ID) {
    lines.push(`Current terminal: ${TERMINAL_ID}`);
  }
  lines.push(...[...heartbeats.values()].map((heartbeat) => renderHeartbeatLine(heartbeat)));
  console.log(lines.join('\n'));
}

async function heartbeatCommand(positionals, options) {
  const [agentId] = positionals;
  const intervalMs = parseIntervalMs(options.interval, AGENT_HEARTBEAT_INTERVAL_MS, 'Usage: heartbeat <agent> [--interval <ms>]');

  if (!agentId) {
    throw new Error('Usage: heartbeat <agent> [--interval <ms>]');
  }

  getAgent(getBoard(), agentId);
  const existingHeartbeat = readAgentHeartbeat(agentId);
  if (existingHeartbeat && existingHeartbeat.pid !== process.pid) {
    throw new Error(`Heartbeat already running for ${agentId} with pid ${existingHeartbeat.pid}. Stop it first if you need to replace it.`);
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    appendJournalLine(`- ${nowIso()} | heartbeat stopped for ${agentId}${TERMINAL_ID ? ` in ${TERMINAL_ID}` : ''}.`);
    clearAgentHeartbeat(agentId, process.pid);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  const initialHeartbeat = buildAgentHeartbeatRecord(agentId, intervalMs, existingHeartbeat, 'heartbeat');
  writeAgentHeartbeatSync(agentId, initialHeartbeat);
  appendJournalLine(`- ${initialHeartbeat.lastHeartbeatAt} | heartbeat started for ${agentId}${TERMINAL_ID ? ` in ${TERMINAL_ID}` : ''}.`);
  console.log(`Heartbeat started for ${agentId} with pid ${process.pid}.${TERMINAL_ID ? ` Terminal ${TERMINAL_ID}.` : ''}`);

  while (true) {
    const nextHeartbeat = buildAgentHeartbeatRecord(agentId, intervalMs, initialHeartbeat, 'heartbeat');
    writeAgentHeartbeatSync(agentId, nextHeartbeat);
    await delay(intervalMs);
  }
}

async function heartbeatStartCommand(positionals, options) {
  const [agentId] = positionals;
  const intervalMs = parseIntervalMs(
    options.interval,
    AGENT_HEARTBEAT_INTERVAL_MS,
    'Usage: heartbeat-start <agent> [--interval <ms>]'
  );

  if (!agentId) {
    throw new Error('Usage: heartbeat-start <agent> [--interval <ms>]');
  }

  getAgent(getBoard(), agentId);
  const existingHeartbeat = readAgentHeartbeat(agentId);
  if (existingHeartbeat) {
    console.log(`Heartbeat already running for ${agentId} with pid ${existingHeartbeat.pid}.`);
    return;
  }

  const scriptPath = COORDINATOR_SCRIPT_PATH;
  const heartbeatOutPath = path.join(RUNTIME_ROOT, `${agentId}.heartbeat.out.log`);
  const heartbeatErrPath = path.join(RUNTIME_ROOT, `${agentId}.heartbeat.err.log`);
  let childPid = null;

  if (process.platform === 'win32') {
    const escapedNodePath = process.execPath.replace(/'/g, "''");
    const escapedScriptPath = scriptPath.replace(/'/g, "''");
    const escapedRoot = ROOT.replace(/'/g, "''");
    const escapedCoordinationRoot = COORDINATION_ROOT.replace(/'/g, "''");
    const escapedTerminalId = (TERMINAL_ID ?? '').replace(/'/g, "''");
    const escapedOutPath = heartbeatOutPath.replace(/'/g, "''");
    const escapedErrPath = heartbeatErrPath.replace(/'/g, "''");
    const startCommand =
      `$env:AGENT_COORDINATION_ROOT='${escapedCoordinationRoot}'; ` +
      `$env:AGENT_COORDINATION_DIR=''; ` +
      `$env:AGENT_TERMINAL_ID='${escapedTerminalId}'; ` +
      `$proc = Start-Process -FilePath '${escapedNodePath}' ` +
      `-ArgumentList @('${escapedScriptPath}','heartbeat','${agentId}','--interval','${intervalMs}') ` +
      `-WorkingDirectory '${escapedRoot}' -WindowStyle Hidden ` +
      `-RedirectStandardOutput '${escapedOutPath}' -RedirectStandardError '${escapedErrPath}' -PassThru; ` +
      `$proc.Id`;
    childPid = Number.parseInt(
      execFileSync('powershell.exe', ['-NoProfile', '-Command', startCommand], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      10
    );
  } else {
    const outFd = fs.openSync(heartbeatOutPath, 'a');
    const errFd = fs.openSync(heartbeatErrPath, 'a');
    const child = spawn(process.execPath, [scriptPath, 'heartbeat', agentId, '--interval', String(intervalMs)], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      env: {
        ...process.env,
        AGENT_COORDINATION_ROOT: COORDINATION_ROOT,
        AGENT_COORDINATION_DIR: '',
        ...(TERMINAL_ID ? { AGENT_TERMINAL_ID: TERMINAL_ID } : {}),
      },
    });
    child.unref();
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    childPid = child.pid;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const heartbeat = readAgentHeartbeat(agentId);
    if (heartbeat && heartbeat.pid === childPid) {
      console.log(`Heartbeat started for ${agentId} with pid ${heartbeat.pid}.${heartbeat.terminalId ? ` Terminal ${heartbeat.terminalId}.` : ''}`);
      return;
    }
    await delay(100);
  }

  throw new Error(`Heartbeat start was requested for ${agentId}, but no heartbeat was detected within 5 seconds.`);
}

async function heartbeatStopCommand(positionals) {
  const [agentId] = positionals;

  if (!agentId) {
    throw new Error('Usage: heartbeat-stop <agent>');
  }

  getAgent(getBoard(), agentId);
  const heartbeat = readJson(getAgentHeartbeatPath(agentId), null);

  if (!heartbeat || typeof heartbeat.pid !== 'number' || !isPidAlive(heartbeat.pid)) {
    clearAgentHeartbeat(agentId);
    appendJournalLine(`- ${nowIso()} | heartbeat cleared for ${agentId} because no live process was found.`);
    console.log(`Heartbeat is not running for ${agentId}.`);
    return;
  }

  process.kill(heartbeat.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const liveHeartbeat = readAgentHeartbeat(agentId);
    if (!liveHeartbeat || liveHeartbeat.pid !== heartbeat.pid) {
      clearAgentHeartbeat(agentId, heartbeat.pid);
      appendJournalLine(`- ${nowIso()} | heartbeat stopped for ${agentId}.`);
      console.log(`Heartbeat ${heartbeat.pid} stopped for ${agentId}.`);
      return;
    }
    await delay(100);
  }

  throw new Error(`Heartbeat ${heartbeat.pid} for ${agentId} did not stop within 5 seconds.`);
}

function renderWatchStatus(status = getWatcherStatus()) {
  if (!status || !isWatcherAlive(status)) {
    return 'Watcher: stopped';
  }

  return [
    'Watcher: running',
    `PID: ${status.pid}`,
    `Started: ${status.startedAt}`,
    `Interval: ${status.intervalMs}ms`,
    `Last heartbeat: ${status.lastHeartbeatAt ?? 'not yet'}`,
    `Last sweep: ${status.lastSweepAt ?? 'not yet'}`,
    `Last auto-heal: ${
      status.lastAutoHeal
        ? `${status.lastAutoHeal.tasks} task(s), ${status.lastAutoHeal.resources} resource(s), ${status.lastAutoHeal.incidents} incident(s) at ${status.lastAutoHeal.at}`
        : 'none'
    }`,
  ].join('\n');
}

async function watcherSweep() {
  return withMutationLock(async () => {
    const board = getBoard();
    const report = buildRecoveryReport(board);
    const total = report.staleTasks.length + report.staleResources.length + report.staleIncidents.length;
    const timestamp = nowIso();

    if (total) {
      applyRecovery(board, report, timestamp);
      appendJournalLine(
        `- ${timestamp} | watcher auto-heal: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
      );
      await saveBoard(board);
    }

    return {
      at: timestamp,
      tasks: report.staleTasks.length,
      resources: report.staleResources.length,
      incidents: report.staleIncidents.length,
    };
  });
}

async function watchTickCommand(options) {
  ensureBaseFiles();
  const watcherPid = Number.parseInt(String(options['watcher-pid'] ?? ''), 10);
  const intervalMs = Number.parseInt(String(options.interval ?? WATCH_INTERVAL_MS), 10);

  if (!Number.isFinite(watcherPid)) {
    throw new Error('Usage: watch-tick --watcher-pid <pid> [--interval <ms>]');
  }

  const existingStatus = getWatcherStatus();
  const sweep = await watcherSweep();
  const timestamp = nowIso();

  await writeWatcherStatus({
    pid: watcherPid,
    startedAt: existingStatus?.pid === watcherPid ? existingStatus.startedAt : timestamp,
    intervalMs,
    lastHeartbeatAt: timestamp,
    lastSweepAt: sweep.at,
    lastAutoHeal: sweep.tasks || sweep.resources || sweep.incidents ? sweep : existingStatus?.lastAutoHeal ?? null,
  });
}

async function watchCommand(options) {
  ensureBaseFiles();
  const intervalMs = Number.parseInt(String(options.interval ?? WATCH_INTERVAL_MS), 10);

  if (!Number.isFinite(intervalMs) || intervalMs < 5000) {
    throw new Error('Usage: watch [--interval <ms>] with interval >= 5000.');
  }

  const existingStatus = getWatcherStatus();
  if (isWatcherAlive(existingStatus) && existingStatus.pid !== process.pid) {
    throw new Error(`Watcher already running with pid ${existingStatus.pid}. Use "watch-stop" first if you need to restart it.`);
  }

  const startedAt = nowIso();
  await writeWatcherStatus({
    pid: process.pid,
    startedAt,
    intervalMs,
    lastHeartbeatAt: startedAt,
    lastSweepAt: null,
    lastAutoHeal: null,
  });

  const cleanup = () => {
    const status = getWatcherStatus();
    if (status?.pid === process.pid) {
      clearWatcherStatus();
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  console.log(`Watcher started with pid ${process.pid}. Interval ${intervalMs}ms.`);

  while (true) {
    const sweep = await watcherSweep();
    const status = getWatcherStatus();
    if (!status || status.pid !== process.pid) {
      break;
    }

    await writeWatcherStatus({
      ...status,
      pid: process.pid,
      lastHeartbeatAt: nowIso(),
      lastSweepAt: sweep.at,
      lastAutoHeal: sweep.tasks || sweep.resources || sweep.incidents ? sweep : status.lastAutoHeal ?? null,
    });

    await delay(intervalMs);
  }
}

async function watchStartCommand(options) {
  await withMutationLock(async () => {
    ensureBaseFiles();
    const existingStatus = getWatcherStatus();

    if (isWatcherAlive(existingStatus)) {
      console.log(`Watcher already running with pid ${existingStatus.pid}.`);
      return;
    }

    const scriptPath = COORDINATOR_SCRIPT_PATH;
    const watchArgs = [scriptPath, 'watch'];
    if (options.interval) {
      watchArgs.push('--interval', String(options.interval));
    }

    if (process.platform === 'win32') {
      const intervalMs = Number.parseInt(String(options.interval ?? WATCH_INTERVAL_MS), 10);
      const watchLoopPath = WATCH_LOOP_SCRIPT_PATH;
      const escapedNodePath = process.execPath.replace(/'/g, "''");
      const escapedScriptPath = scriptPath.replace(/'/g, "''");
      const escapedWatchLoopPath = watchLoopPath.replace(/'/g, "''");
      const escapedRoot = ROOT.replace(/'/g, "''");
      const escapedCoordinationRoot = COORDINATION_ROOT.replace(/'/g, "''");
      const startCommand =
        `$proc = Start-Process -FilePath 'powershell.exe' ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedWatchLoopPath}','-NodePath','${escapedNodePath}','-CoordinatorScriptPath','${escapedScriptPath}','-WorkspaceRoot','${escapedRoot}','-IntervalMs','${intervalMs}','-CoordinationRoot','${escapedCoordinationRoot}') ` +
        `-WorkingDirectory '${escapedRoot}' -WindowStyle Hidden -PassThru; ` +
        `$proc.Id`;
      const childPid = Number.parseInt(
        execFileSync('powershell.exe', ['-NoProfile', '-Command', startCommand], {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
        }).trim(),
        10
      );

      if (!Number.isFinite(childPid)) {
        throw new Error('Watcher start failed to return a supervisor pid.');
      }

      await writeWatcherStatus({
        pid: childPid,
        startedAt: nowIso(),
        intervalMs,
        lastHeartbeatAt: null,
        lastSweepAt: null,
        lastAutoHeal: null,
      });
    } else {
      const child = spawn(process.execPath, watchArgs, {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          AGENT_COORDINATION_ROOT: COORDINATION_ROOT,
          AGENT_COORDINATION_DIR: '',
        },
      });
      child.unref();
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const status = getWatcherStatus();
      if (isWatcherAlive(status)) {
        console.log(`Watcher started with pid ${status.pid}.`);
        return;
      }
      await delay(100);
    }

    throw new Error('Watcher start was requested, but no watcher heartbeat was detected within 5 seconds.');
  });
}

function watchStatusCommand() {
  console.log(renderWatchStatus());
}

async function watchStopCommand() {
  await withMutationLock(async () => {
    const status = getWatcherStatus();

    if (!isWatcherAlive(status)) {
      clearWatcherStatus();
      console.log('Watcher is not running.');
      return;
    }

    process.kill(status.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isWatcherAlive(getWatcherStatus())) {
        clearWatcherStatus();
        console.log(`Watcher ${status.pid} stopped.`);
        return;
      }
      await delay(100);
    }

    throw new Error(`Watcher ${status.pid} did not stop within 5 seconds.`);
  });
}

async function recoverCommand(options) {
  if (!options.apply) {
    const referenceIso = nowIso();
    const liveHeartbeats = readAgentHeartbeats(referenceIso, { cleanupStale: false });
    const report = buildRecoveryReport(getReadOnlyBoard(), referenceIso, { liveHeartbeats });
    console.log(renderRecoveryReport(report));
    console.log('\nRun with --apply to convert stale active work into handoff state and abandon stale incidents/resources.');
    return;
  }

  await withMutationLock(async () => {
    const board = getBoard();
    const report = buildRecoveryReport(board);
    const timestamp = nowIso();
    applyRecovery(board, report, timestamp);

    appendJournalLine(
      `- ${timestamp} | recovery applied: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
    );
    await saveBoard(board);
    console.log(renderRecoveryReport(report));
    console.log('\nRecovery applied.');
  });
}

function validateCommand() {
  const board = getReadOnlyBoard();
  const findings = validateBoard(board);

  if (!findings.length) {
    console.log('Board is valid.');
    return;
  }

  console.log(findings.map((finding) => `- ${finding}`).join('\n'));
  process.exitCode = 1;
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  currentCommandName = command;
  const { options, positionals } = parseArgs(rest);
  const autoHealResult = await autoHealIfNeeded(command, options);

  if (autoHealResult) {
    console.log(
      `Auto-heal applied before ${autoHealResult.commandName}: ${autoHealResult.staleTasks} task(s), ${autoHealResult.staleResources} resource(s), ${autoHealResult.staleIncidents} incident(s).`
    );
  }

  switch (command) {
    case 'help':
      printHelp();
      return;
    case 'init':
      await initCommand();
      return;
    case 'status':
      await statusCommand();
      return;
    case 'heartbeat':
      await heartbeatCommand(positionals, options);
      return;
    case 'heartbeat-start':
      await heartbeatStartCommand(positionals, options);
      return;
    case 'heartbeat-stop':
      await heartbeatStopCommand(positionals);
      return;
    case 'heartbeat-status':
      heartbeatStatusCommand(positionals);
      return;
    case 'watch':
      await watchCommand(options);
      return;
    case 'watch-tick':
      await watchTickCommand(options);
      return;
    case 'watch-start':
      await watchStartCommand(options);
      return;
    case 'watch-stop':
      await watchStopCommand();
      return;
    case 'watch-status':
      watchStatusCommand();
      return;
    case 'plan':
      await planCommand(positionals, options);
      return;
    case 'claim':
      await claimCommand(positionals, options);
      return;
    case 'pick':
      pickCommand(positionals);
      return;
    case 'review-docs':
      await reviewDocsCommand(positionals, options);
      return;
    case 'progress':
      await progressCommand(positionals);
      return;
    case 'wait':
      await waitCommand(positionals, options);
      return;
    case 'resume':
      await resumeCommand(positionals);
      return;
    case 'blocked':
      await setTaskStatusCommand(positionals, 'blocked');
      return;
    case 'review':
      await setTaskStatusCommand(positionals, 'review');
      return;
    case 'verify':
      await verifyCommand(positionals, options);
      return;
    case 'request-access':
      await requestAccessCommand(positionals);
      return;
    case 'grant-access':
      await grantAccessCommand(positionals, options);
      return;
    case 'deny-access':
      await denyAccessCommand(positionals, options);
      return;
    case 'complete-access':
      await completeAccessCommand(positionals, options);
      return;
    case 'start-incident':
      await startIncidentCommand(positionals, options);
      return;
    case 'join-incident':
      await joinIncidentCommand(positionals, options);
      return;
    case 'close-incident':
      await closeIncidentCommand(positionals);
      return;
    case 'reserve-resource':
      await reserveResourceCommand(positionals, options);
      return;
    case 'release-resource':
      await releaseResourceCommand(positionals);
      return;
    case 'message':
      await messageCommand(positionals, options);
      return;
    case 'app-note':
      await appNoteCommand(positionals, options);
      return;
    case 'inbox':
      inboxCommand(positionals, options);
      return;
    case 'handoff':
      await handoffCommand(positionals, options);
      return;
    case 'release':
      await releaseCommand(positionals, options);
      return;
    case 'done':
      await doneCommand(positionals);
      return;
    case 'validate':
      validateCommand();
      return;
    case 'doctor':
      doctorCommand();
      return;
    case 'recover':
      await recoverCommand(options);
      return;
    default:
      throw new Error(`Unknown command "${command}". Run "${cliRunLabel(' -- help')}" for usage.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
