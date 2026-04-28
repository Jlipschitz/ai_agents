import { fileURLToPath } from 'node:url';

import { applyGlobalFlags } from './lib/global-flags.mjs';

const __filename = fileURLToPath(import.meta.url);

applyGlobalFlags({
  defaultCoordinationDir: 'coordination',
  defaultCliEntrypoint: 'agents',
  scriptPath: __filename,
  watchLoopScriptPath: 'scripts/agent-watch-loop.mjs',
});

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
