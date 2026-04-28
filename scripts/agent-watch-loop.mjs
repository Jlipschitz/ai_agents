#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    nodePath: process.execPath,
    coordinatorScriptPath: path.join(PACKAGE_ROOT, 'scripts', 'agent-coordination.mjs'),
    workspaceRoot: process.cwd(),
    intervalMs: 30000,
    coordinationRoot: '',
    once: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--node-path') {
      args.nodePath = argv[++index];
    } else if (arg === '--coordinator-script') {
      args.coordinatorScriptPath = argv[++index];
    } else if (arg === '--workspace-root') {
      args.workspaceRoot = argv[++index];
    } else if (arg === '--interval') {
      args.intervalMs = Number.parseInt(argv[++index] ?? '', 10);
    } else if (arg === '--coordination-root') {
      args.coordinationRoot = argv[++index] ?? '';
    } else if (arg === '--once') {
      args.once = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.intervalMs) || args.intervalMs < 1000) {
    throw new Error('--interval must be at least 1000 milliseconds.');
  }

  args.coordinatorScriptPath = path.resolve(args.workspaceRoot, args.coordinatorScriptPath);
  args.workspaceRoot = path.resolve(args.workspaceRoot);

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/agent-watch-loop.mjs [--coordinator-script <path>] [--workspace-root <path>] [--interval <ms>] [--coordination-root <path>] [--once]\n\nRuns the portable watcher loop by repeatedly invoking watch-tick.`);
}

function runTick(args) {
  const env = { ...process.env };
  if (args.coordinationRoot) {
    env.AGENT_COORDINATION_ROOT = args.coordinationRoot;
    env.AGENT_COORDINATION_DIR = '';
  }

  const result = spawnSync(args.nodePath, [
    args.coordinatorScriptPath,
    'watch-tick',
    '--watcher-pid',
    String(process.pid),
    '--interval',
    String(args.intervalMs),
  ], {
    cwd: args.workspaceRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`watch-tick failed: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 0;
}

export async function runWatcher(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  while (true) {
    runTick(args);

    if (args.once) {
      return 0;
    }

    await delay(args.intervalMs);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await runWatcher();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
