import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createBoardValidation } from './lib/board-validation.mjs';
import { createCommunicationCommands } from './lib/communication-commands.mjs';
import { createCorePathAnalysis } from './lib/core-path-analysis.mjs';
import { normalizeClaimPolicies } from './lib/claim-policy.mjs';
import { exitCodeForError, printCliError } from './lib/error-formatting.mjs';
import { ensureDirectory, fileExists, isPidAlive, nowIso } from './lib/file-utils.mjs';
import { createDoctorCommand } from './lib/doctor-command.mjs';
import { createHeartbeatWatchCommands } from './lib/heartbeat-watch-commands.mjs';
import { normalizePath, resolveRepoPath } from './lib/path-utils.mjs';
import { createPlannerCommands } from './lib/planner-commands.mjs';
import { createRecoveryCommands } from './lib/recovery-commands.mjs';
import { createStatusCommands } from './lib/status-commands.mjs';
import { createSupportOperationCommands } from './lib/support-operation-commands.mjs';
import { createTaskCompletionCommands } from './lib/task-completion-commands.mjs';
import { createTaskLifecycleCommands } from './lib/task-lifecycle-commands.mjs';

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
const ARTIFACT_ROOTS = normalizeConfigPathArray(AGENT_CONFIG.artifacts?.roots, ['artifacts']);
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
const CLAIM_POLICIES = normalizeClaimPolicies(AGENT_CONFIG);
const {
  classifyGitPaths,
  collectMergeRiskWarnings,
  getGitBranchSnapshot,
  getGitChangedPaths,
  hasVisualCheck,
  hasVisualImpact,
  hasVisualSuiteScope,
  inferDomainsFromPaths,
  isVisualSuitePath,
  mergeVerificationChecks,
  pathStartsWith,
} = createCorePathAnalysis({
  root: ROOT,
  visualSuitePaths: VISUAL_SUITE_PATHS,
  visualImpactPaths: VISUAL_IMPACT_PATHS,
  visualImpactFiles: VISUAL_IMPACT_FILES,
  sharedRiskPaths: SHARED_RISK_PATHS,
  pathClassification: PATH_CLASSIFICATION,
  coordinationLabel: COORDINATION_LABEL,
  domainRules: DOMAIN_RULES,
  ensureTaskDefaults,
});
const { getLatestVerificationOutcomes, validateBoard } = createBoardValidation({
  activeTaskStatuses: ACTIVE_TASK_STATUSES,
  agentIds: AGENT_IDS,
  docReviewRequiredStatuses: DOC_REVIEW_REQUIRED_STATUSES,
  ensureTaskDefaults,
  getMissingVisualPassingChecks,
  getTask,
  hasLiveAgentHeartbeat,
  hasVisualCheck,
  hasVisualImpact,
  hasVisualVerificationCompanion,
  isIncidentStale,
  isResourceStale,
  isTaskStale,
  pathsOverlap,
  readAgentHeartbeats,
  resourceStaleHours: RESOURCE_STALE_HOURS,
  staleIncidentHours: STALE_INCIDENT_HOURS,
  staleTaskHours: STALE_TASK_HOURS,
  validAccessStatuses: VALID_ACCESS_STATUSES,
  validIncidentStatuses: VALID_INCIDENT_STATUSES,
  validTaskStatuses: VALID_TASK_STATUSES,
  visualRequiredChecks: VISUAL_REQUIRED_CHECKS,
});
const { doneCommand, releaseCommand, verifyCommand } = createTaskCompletionCommands({
  root: ROOT,
  artifactRoots: ARTIFACT_ROOTS,
  appAgentNotesDoc: APP_AGENT_NOTES_DOC,
  appendJournalLine,
  cliRunLabel,
  ensureTask,
  getBoard,
  getCommandAgent,
  getMissingVisualPassingChecks,
  note,
  saveBoard,
  withMutationLock,
});
const {
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
} = createSupportOperationCommands({
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
});
const { planCommand } = createPlannerCommands({
  agentIds: AGENT_IDS,
  appendJournalLine,
  appAgentNotesDoc: APP_AGENT_NOTES_DOC,
  classifyGitPaths,
  coordinationReadmePath: COORDINATION_README_PATH,
  defaultAgentIds: DEFAULT_AGENT_IDS,
  defaultDomainNames: DEFAULT_DOMAIN_NAMES,
  domainRules: DOMAIN_RULES,
  getBoard,
  getGitChangedPaths,
  inferDomainsFromPaths,
  inferRelevantDocs,
  plannedTaskStatus: PLANNED_TASK_STATUS,
  planningAgentSizing: PLANNING_AGENT_SIZING,
  planningDataFallbackPaths: PLANNING_DATA_FALLBACK_PATHS,
  planningDocsFallbackPaths: PLANNING_DOCS_FALLBACK_PATHS,
  planningProductFallbackPaths: PLANNING_PRODUCT_FALLBACK_PATHS,
  planningVerifyFallbackPaths: PLANNING_VERIFY_FALLBACK_PATHS,
  saveBoard,
  slugify,
  visualRequiredChecks: VISUAL_REQUIRED_CHECKS,
  visualSuiteDefaultPaths: VISUAL_SUITE_DEFAULT_PATHS,
  visualSuiteUpdateChecks: VISUAL_SUITE_UPDATE_CHECKS,
  withMutationLock,
});
const { applyRecovery, autoHealIfNeeded, buildRecoveryReport, recoverCommand } = createRecoveryCommands({
  appendJournalLine,
  autoHealExcludedCommands: AUTO_HEAL_EXCLUDED_COMMANDS,
  getBoard,
  getReadOnlyBoard,
  hasLiveAgentHeartbeat,
  isIncidentStale,
  isReadOnlyCommand,
  isResourceStale,
  isTaskStale,
  note,
  readAgentHeartbeats,
  saveBoard,
  withMutationLock,
});
const {
  heartbeatCommand,
  heartbeatStartCommand,
  heartbeatStatusCommand,
  heartbeatStopCommand,
  watchCommand,
  watchStartCommand,
  watchStatusCommand,
  watchStopCommand,
  watchTickCommand,
} = createHeartbeatWatchCommands({
  agentHeartbeatIntervalMs: AGENT_HEARTBEAT_INTERVAL_MS,
  appendJournalLine,
  applyRecovery,
  buildRecoveryReport,
  clearAgentHeartbeat,
  clearWatcherStatus,
  coordinationLabel: COORDINATION_LABEL,
  coordinationRoot: COORDINATION_ROOT,
  coordinatorScriptPath: COORDINATOR_SCRIPT_PATH,
  ensureBaseFiles,
  getAgent,
  getAgentHeartbeatPath,
  getBoard,
  getBoardSnapshot,
  getTask,
  getWatcherStatus,
  isWatcherAlive,
  minAgentHeartbeatIntervalMs: MIN_AGENT_HEARTBEAT_INTERVAL_MS,
  readAgentHeartbeat,
  readAgentHeartbeats,
  readJson,
  renderHeartbeatLine,
  root: ROOT,
  runtimeRoot: RUNTIME_ROOT,
  saveBoard,
  terminalId: TERMINAL_ID,
  watchIntervalMs: WATCH_INTERVAL_MS,
  watchLoopScriptPath: WATCH_LOOP_SCRIPT_PATH,
  withMutationLock,
  writeAgentHeartbeatSync,
  writeWatcherStatus,
});
const { doctorCommand } = createDoctorCommand({
  agentConfigPath: AGENT_CONFIG_PATH,
  agentIds: AGENT_IDS,
  appAgentNotesDoc: APP_AGENT_NOTES_DOC,
  boardPath: BOARD_PATH,
  cliRunLabel,
  coordinatorScriptPath: COORDINATOR_SCRIPT_PATH,
  coordinationLabel: COORDINATION_LABEL,
  docsRoots: DOCS_ROOTS,
  domainRules: DOMAIN_RULES,
  getBoardSnapshot,
  projectName: PROJECT_NAME,
  readAgentHeartbeats,
  readJson,
  root: ROOT,
  validateBoard,
  visualRequiredChecks: VISUAL_REQUIRED_CHECKS,
  visualSuiteUpdateChecks: VISUAL_SUITE_UPDATE_CHECKS,
  visualWorkflowDoc: VISUAL_WORKFLOW_DOC,
  watchLoopScriptPath: WATCH_LOOP_SCRIPT_PATH,
});
const {
  buildDependencyInsight,
  buildLockContentionSummary,
  buildWaitingInsights,
  maybeQueueAssistMessages,
  statusCommand,
} = createStatusCommands({
  appendJournalLine,
  appendMessage,
  assistMessageWindowHours: ASSIST_MESSAGE_WINDOW_HOURS,
  describeLock,
  ensureTaskDefaults,
  formatElapsed,
  getReadOnlyBoard,
  getStaleResources,
  getTask,
  getTaskStatusReason,
  getWatcherStatus,
  hasLiveAgentHeartbeat,
  isTaskStale,
  isWatcherAlive,
  note,
  plannedTaskStatus: PLANNED_TASK_STATUS,
  readAgentHeartbeats,
  readMessages,
  renderHeartbeatLine,
});
const {
  claimCommand,
  handoffCommand,
  initCommand,
  pickCommand,
  progressCommand,
  resumeCommand,
  reviewDocsCommand,
  setTaskStatusCommand,
  waitCommand,
} = createTaskLifecycleCommands({
  activeTaskStatuses: ACTIVE_TASK_STATUSES,
  appendJournalLine,
  assertAgentSessionAvailable,
  buildDependencyInsight,
  buildWaitingInsights,
  claimPolicies: CLAIM_POLICIES,
  collectMergeRiskWarnings,
  coordinationLabel: COORDINATION_LABEL,
  ensureBaseFiles,
  ensureTask,
  ensureVisualVerificationForTask,
  getAgent,
  getBoard,
  getCommandAgent,
  getCurrentCommandName: () => currentCommandName,
  getGitBranchSnapshot,
  getGitChangedPaths,
  getReadOnlyBoard,
  getTask,
  getVisualVerificationChecksForTask,
  hasVisualImpact,
  inferRelevantDocs,
  inferDomainsFromPaths,
  isTaskStale,
  maybeQueueAssistMessages,
  note,
  parsePathsOption,
  pathsOverlap,
  plannedTaskStatus: PLANNED_TASK_STATUS,
  saveBoard,
  slugify,
  terminalTaskStatuses: TERMINAL_TASK_STATUSES,
  withMutationLock,
});
const { appNoteCommand, inboxCommand, messageCommand } = createCommunicationCommands({
  appAgentNotesDoc: APP_AGENT_NOTES_DOC,
  appNoteCategories: APP_NOTE_CATEGORIES,
  appNotesSectionHeading: APP_NOTES_SECTION_HEADING,
  appendJournalLine,
  appendMessage,
  assertAgentSessionAvailable,
  ensureTask,
  getAgent,
  getBoard,
  getCommandAgent,
  getCurrentCommandName: () => currentCommandName,
  getReadOnlyBoard,
  getTask,
  note,
  parsePathsOption,
  projectName: PROJECT_NAME,
  readMessages,
  root: ROOT,
  saveBoard,
  withMutationLock,
  writeTextAtomicSync,
});

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
- Git branch: ${task.gitBranch ? `\`${task.gitBranch}\`${task.gitUpstream ? ` tracking \`${task.gitUpstream}\`` : ''}` : 'not recorded'}
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
  const expiresMs = Date.parse(resource.expiresAt ?? '');
  const referenceMs = Date.parse(referenceIso);
  if (Number.isFinite(expiresMs) && Number.isFinite(referenceMs) && expiresMs <= referenceMs) {
    return true;
  }
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
  reserve-resource <agent> <resource> <reason> [--task <task-id>] [--ttl-minutes <minutes>]
  renew-resource <agent> <resource> [--ttl-minutes <minutes>] [--reason <text>]
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
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
    case 'renew-resource':
      await renewResourceCommand(positionals, options);
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
  printCliError(error, { argv: process.argv.slice(2) });
  process.exit(exitCodeForError(error));
});
