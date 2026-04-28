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
  process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = path.join(packageRoot, 'scripts', 'agent-watch-loop.ps1');
}

await import('../scripts/agent-coordination-core.mjs');
