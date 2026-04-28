#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyGlobalFlags } from '../scripts/lib/global-flags.mjs';
import { runVersionCommand } from '../scripts/lib/version-command.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
applyGlobalFlags({
  defaultCoordinationDir: 'coordination',
  defaultCliEntrypoint: 'ai-agents',
  scriptPath: __filename,
  watchLoopScriptPath: path.join(packageRoot, 'scripts', 'agent-watch-loop.mjs'),
});
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
  const versionArgs = args[0] === 'version' ? args.slice(1) : args;
  process.exit(runVersionCommand(versionArgs, { root: process.cwd(), packageRoot, packageJsonPath }));
}

if (args[0] === 'explain-config') {
  const { runCli } = await import('../scripts/explain-config.mjs');
  process.exitCode = runCli(args.slice(1));
} else {
  const { runCommandLayer } = await import('../scripts/agent-command-layer.mjs');

  await runCommandLayer({
    coordinatorScriptPath: __filename,
    importCore: async () => import('../scripts/agent-coordination-core.mjs'),
  });
}
