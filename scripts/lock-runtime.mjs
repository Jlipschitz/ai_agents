#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const DEFAULT_STALE_MS = 300000;

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0] || 'status',
    json: false,
    staleOnly: false,
    force: false,
    coordinationRoot: '',
    coordinationDir: '',
    staleMs: DEFAULT_STALE_MS,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--stale-only') parsed.staleOnly = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--coordination-root') parsed.coordinationRoot = argv[++index] ?? '';
    else if (arg === '--coordination-dir') parsed.coordinationDir = argv[++index] ?? '';
    else if (arg === '--stale-ms') {
      const value = Number.parseInt(String(argv[++index] ?? ''), 10);
      if (Number.isFinite(value) && value >= 1000) parsed.staleMs = value;
    } else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function resolveCoordinationRoot(args) {
  const rootOverride = args.coordinationRoot || String(process.env.AGENT_COORDINATION_ROOT ?? '').trim();
  if (rootOverride) return path.isAbsolute(rootOverride) ? rootOverride : path.resolve(ROOT, rootOverride);

  const dirOverride = args.coordinationDir || String(process.env.AGENT_COORDINATION_DIR ?? '').trim();
  return path.join(ROOT, dirOverride || 'coordination');
}

function lockPath(args) {
  return path.join(resolveCoordinationRoot(args), 'runtime', 'state.lock.json');
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { malformed: true, error: error.message };
  }
}

function isPidAlive(pid) {
  const normalizedPid = Number.parseInt(String(pid ?? ''), 10);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) return null;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function parseTime(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getLockTimestamp(lock) {
  return parseTime(lock?.lockedAt) ?? parseTime(lock?.updatedAt) ?? parseTime(lock?.createdAt) ?? parseTime(lock?.acquiredAt) ?? parseTime(lock?.at);
}

function inspectLock(args) {
  const filePath = lockPath(args);
  const lock = readJsonSafe(filePath);
  const now = Date.now();
  const timestamp = getLockTimestamp(lock);
  const ageMs = timestamp ? Math.max(0, now - timestamp) : null;
  const pidAlive = lock && !lock.malformed ? isPidAlive(lock.pid) : null;
  const staleByAge = ageMs !== null ? ageMs >= args.staleMs : false;
  const staleByPid = pidAlive === false;
  const exists = fs.existsSync(filePath);

  return {
    exists,
    path: filePath,
    coordinationRoot: resolveCoordinationRoot(args),
    stale: exists && Boolean(lock?.malformed || staleByAge || staleByPid),
    staleReasons: [
      lock?.malformed ? 'malformed-json' : null,
      staleByAge ? `older-than-${args.staleMs}ms` : null,
      staleByPid ? 'pid-not-running' : null,
    ].filter(Boolean),
    ageMs,
    staleMs: args.staleMs,
    pidAlive,
    lock,
  };
}

function printStatus(status, json) {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (!status.exists) {
    console.log(`No runtime lock found at ${status.path}`);
    return;
  }

  console.log(`Runtime lock: ${status.path}`);
  console.log(`Stale: ${status.stale ? 'yes' : 'no'}`);
  if (status.staleReasons.length) console.log(`Reasons: ${status.staleReasons.join(', ')}`);
  if (status.ageMs !== null) console.log(`Age: ${status.ageMs}ms`);
  if (status.pidAlive !== null) console.log(`PID alive: ${status.pidAlive ? 'yes' : 'no'}`);
  if (status.lock?.command) console.log(`Command: ${status.lock.command}`);
  if (status.lock?.owner) console.log(`Owner: ${status.lock.owner}`);
}

function clearLock(args) {
  const status = inspectLock(args);
  if (!status.exists) return { ...status, cleared: false, message: 'No runtime lock exists.' };
  if (args.staleOnly && !status.stale) return { ...status, cleared: false, message: 'Lock exists but is not stale.' };
  if (!args.staleOnly && !args.force) return { ...status, cleared: false, message: 'Refusing to clear without --stale-only or --force.' };

  fs.rmSync(status.path, { force: true });
  return { ...status, cleared: true, message: 'Runtime lock cleared.' };
}

function printClear(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.message);
  if (result.cleared) console.log(`Removed: ${result.path}`);
  else if (result.exists) printStatus(result, false);
}

function printHelp() {
  console.log(`Usage:\n  node scripts/lock-runtime.mjs status [--json] [--coordination-dir <dir>] [--coordination-root <path>]\n  node scripts/lock-runtime.mjs clear --stale-only [--json] [--coordination-dir <dir>] [--coordination-root <path>]\n\nUse --force to clear a non-stale lock intentionally.`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.command === 'status' || args.command === 'lock-status') {
    printStatus(inspectLock(args), args.json);
    return 0;
  }

  if (args.command === 'clear' || args.command === 'lock-clear') {
    const result = clearLock(args);
    printClear(result, args.json);
    return result.cleared || !result.exists ? 0 : 1;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

if (isCliEntrypoint()) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
