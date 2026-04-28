#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  console.log(`${packageJson.name} ${packageJson.version}`);
  console.log(`node ${process.version}`);
  process.exit(0);
}

if (!process.env.AGENT_COORDINATION_ROOT && !process.env.AGENT_COORDINATION_DIR) {
  process.env.AGENT_COORDINATION_DIR = 'coordination';
}

if (!process.env.AGENT_COORDINATION_CLI_ENTRYPOINT) {
  process.env.AGENT_COORDINATION_CLI_ENTRYPOINT = 'ai-agents';
}

if (!process.env.AGENT_COORDINATION_SCRIPT) {
  process.env.AGENT_COORDINATION_SCRIPT = __filename;
}

if (!process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT) {
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = path.join(packageRoot, 'scripts', 'agent-watch-loop.mjs');
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
