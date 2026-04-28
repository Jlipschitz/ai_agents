export const CHECK_COMMAND = 'node ./scripts/check-syntax.mjs';
export const LINT_COMMAND = 'node ./scripts/lint.mjs';
export const JSDOC_CHECK_COMMAND = 'node ./scripts/jsdoc-check.mjs';

const MAIN_COORDINATOR = './scripts/agent-coordination.mjs';
const SECONDARY_COORDINATOR = './scripts/agent-coordination-two.mjs';
const WATCH_LOOP = './scripts/agent-watch-loop.mjs';

export const COORDINATOR_SHORTCUTS = [
  ['init', 'init'],
  ['plan', 'plan'],
  ['status', 'status'],
  ['interactive', 'interactive'],
  ['validate', 'validate'],
  ['doctor', 'doctor'],
  ['doctor:json', 'doctor --json'],
  ['doctor:fix', 'doctor --fix'],
  ['explain-config', 'explain-config'],
  ['summarize', 'summarize'],
  ['start', 'start'],
  ['finish', 'finish'],
  ['handoff-ready', 'handoff-ready'],
  ['handoff:bundle', 'handoff-bundle'],
  ['next', 'next'],
  ['lock:status', 'lock-status'],
  ['lock:clear', 'lock-clear --stale-only'],
  ['heartbeat:start', 'heartbeat-start'],
  ['heartbeat:stop', 'heartbeat-stop'],
  ['heartbeat:status', 'heartbeat-status'],
  ['watch:start', 'watch-start'],
  ['watch:status', 'watch-status'],
  ['watch:stop', 'watch-stop'],
  ['watch:node', 'watch-node'],
  ['watch:diagnose', 'watch-diagnose'],
  ['runtime:cleanup', 'cleanup-runtime'],
  ['release:check', 'release-check'],
  ['release:sign', 'release-sign'],
  ['board:inspect', 'inspect-board'],
  ['board:repair', 'repair-board'],
  ['board:migrate', 'migrate-board'],
  ['state:rollback', 'rollback-state'],
  ['state:compact', 'compact-state'],
  ['state:size', 'state-size'],
  ['status:badge', 'status-badge'],
  ['fixture:board', 'fixture-board'],
  ['run-check', 'run-check'],
  ['policy:check', 'policy-check'],
  ['format', 'format'],
  ['branches', 'branches'],
  ['ownership:review', 'ownership-review'],
  ['test-impact', 'test-impact'],
  ['risk:score', 'risk-score'],
  ['critical:path', 'critical-path'],
  ['health:score', 'health-score'],
  ['agent:history', 'agent-history'],
  ['cost:time', 'cost-time'],
  ['review:queue', 'review-queue'],
  ['dashboard', 'dashboard'],
  ['timeline', 'timeline'],
  ['publish:check', 'publish-check'],
  ['redact:check', 'redact-check'],
  ['secrets:scan', 'secrets-scan'],
  ['contracts', 'contracts'],
  ['runbooks', 'runbooks'],
  ['path:groups', 'path-groups'],
  ['split:validate', 'split-validate'],
  ['escalation:route', 'escalation-route'],
  ['work:steal', 'steal-work'],
  ['github:status', 'github-status'],
  ['templates', 'templates'],
  ['archive:completed', 'archive-completed'],
  ['update', 'update-coordinator'],
  ['snapshot:workspace', 'snapshot-workspace'],
  ['backlog:import', 'backlog-import'],
  ['prompt', 'prompt'],
  ['ask', 'ask'],
  ['calendar', 'calendar'],
  ['changelog', 'changelog'],
  ['prioritize', 'prioritize'],
  ['approvals', 'approvals'],
  ['completions', 'completions'],
];

function addCoordinatorScripts(scripts, prefix, coordinatorScript) {
  scripts[prefix] = `node ${coordinatorScript}`;
  for (const [shortcut, command] of COORDINATOR_SHORTCUTS) {
    scripts[`${prefix}:${shortcut}`] = command === 'watch-node'
      ? `node ${WATCH_LOOP} --coordinator-script ${coordinatorScript}`
      : `node ${coordinatorScript} ${command}`;
  }
}

function addPortableCoordinatorScripts(scripts) {
  scripts.agents = 'ai-agents';
  for (const [shortcut, command] of COORDINATOR_SHORTCUTS) {
    if (command === 'watch-node') continue;
    scripts[`agents:${shortcut}`] = `ai-agents ${command}`;
  }
}

export function buildLocalPackageScripts() {
  const scripts = {
    'ai-agents': 'node ./bin/ai-agents.mjs',
    'bootstrap': 'node ./scripts/bootstrap.mjs',
    'check': CHECK_COMMAND,
    'lint': LINT_COMMAND,
    'jsdoc:check': JSDOC_CHECK_COMMAND,
    'format': 'node ./scripts/agent-coordination.mjs format --apply',
    'format:check': 'node ./scripts/agent-coordination.mjs format --check',
  };
  addCoordinatorScripts(scripts, 'agents', MAIN_COORDINATOR);
  addCoordinatorScripts(scripts, 'agents2', SECONDARY_COORDINATOR);
  scripts['validate:agents-config'] = 'node ./scripts/validate-config.mjs';
  return scripts;
}

export function buildPortablePackageScripts() {
  const scripts = {
    'ai-agents': 'ai-agents',
    'format': 'ai-agents format --apply',
    'format:check': 'ai-agents format --check',
  };
  addPortableCoordinatorScripts(scripts);
  scripts['validate:agents-config'] = 'ai-agents validate --json';
  return scripts;
}

export function buildPackageScripts({ local = true } = {}) {
  return local ? buildLocalPackageScripts() : buildPortablePackageScripts();
}
