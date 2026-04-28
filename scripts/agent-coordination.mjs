if (!process.env.AGENT_COORDINATION_ROOT && !process.env.AGENT_COORDINATION_DIR) {
  process.env.AGENT_COORDINATION_DIR = 'coordination';
}

if (!process.env.AGENT_COORDINATION_CLI_ENTRYPOINT) {
  process.env.AGENT_COORDINATION_CLI_ENTRYPOINT = 'agents';
}

if (!process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT) {
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = 'scripts/agent-watch-loop.mjs';
}

if (!process.env.AGENT_COORDINATION_SCRIPT) {
  process.env.AGENT_COORDINATION_SCRIPT = 'scripts/agent-coordination.mjs';
}

const { runCommandLayer } = await import('./agent-command-layer.mjs');

await runCommandLayer({
  coordinatorScriptPath: 'scripts/agent-coordination.mjs',
  importCore: async () => import('./agent-coordination-core.mjs'),
});
