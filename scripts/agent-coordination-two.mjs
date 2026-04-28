if (!process.env.AGENT_COORDINATION_CLI_ENTRYPOINT) {
  process.env.AGENT_COORDINATION_CLI_ENTRYPOINT = 'agents2';
}

if (!process.env.AGENT_COORDINATION_SCRIPT) {
  process.env.AGENT_COORDINATION_SCRIPT = 'scripts/agent-coordination-two.mjs';
}

if (!process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT) {
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = 'scripts/agent-watch-loop-two.ps1';
}

await import('./agent-coordination-core.mjs');
