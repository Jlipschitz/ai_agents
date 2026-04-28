import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

if (!process.env.AGENT_COORDINATION_ROOT && !process.env.AGENT_COORDINATION_DIR) {
  process.env.AGENT_COORDINATION_DIR = 'coordination-two';
}

if (!process.env.AGENT_COORDINATION_CLI_ENTRYPOINT) {
  process.env.AGENT_COORDINATION_CLI_ENTRYPOINT = 'agents2';
}

if (!process.env.AGENT_COORDINATION_SCRIPT) {
  process.env.AGENT_COORDINATION_SCRIPT = __filename;
}

if (!process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT) {
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = 'scripts/agent-watch-loop.mjs';
}

if (process.argv[2] === 'explain-config') {
  const { runCli } = await import('./explain-config.mjs');
  process.exitCode = runCli(process.argv.slice(3));
} else {
  const { runCommandLayer } = await import('./agent-command-layer.mjs');

  await runCommandLayer({
    coordinatorScriptPath: __filename,
    importCore: async () => import('./agent-coordination-core.mjs'),
  });
}
