import fs from 'node:fs';
import path from 'node:path';

import { getNumberFlag, hasFlag } from './args-utils.mjs';
import { isPidAlive, parseIsoMs, readJsonDetailed } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';

const DEFAULT_RUNTIME_STALE_MS = 300000;
const DEFAULT_HEARTBEAT_TTL_MS = 90000;

function getLockTimestamp(lock) {
  return parseIsoMs(lock?.lockedAt) ?? parseIsoMs(lock?.updatedAt) ?? parseIsoMs(lock?.createdAt) ?? parseIsoMs(lock?.acquiredAt) ?? parseIsoMs(lock?.at);
}

function inspectRuntimeLock(paths, staleMs = DEFAULT_RUNTIME_STALE_MS) {
  const lockPath = path.join(paths.runtimeRoot, 'state.lock.json');
  const lockFile = readJsonDetailed(lockPath);
  if (!lockFile.exists) return { exists: false, path: lockPath, stale: false, staleReasons: [], ageMs: null, pidAlive: null, lock: null };
  if (lockFile.error) return { exists: true, path: lockPath, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, lock: null, error: lockFile.error };
  const timestamp = getLockTimestamp(lockFile.value);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const pidAlive = isPidAlive(lockFile.value?.pid);
  const staleByAge = ageMs !== null && ageMs >= staleMs;
  const staleByPid = pidAlive === false;
  return {
    exists: true,
    path: lockPath,
    stale: Boolean(staleByAge || staleByPid),
    staleReasons: [staleByAge ? `older-than-${staleMs}ms` : null, staleByPid ? 'pid-not-running' : null].filter(Boolean),
    ageMs,
    pidAlive,
    lock: lockFile.value,
  };
}

function getWatcherTimestamp(status) {
  return parseIsoMs(status?.lastHeartbeatAt) ?? parseIsoMs(status?.updatedAt) ?? parseIsoMs(status?.lastSweepAt) ?? parseIsoMs(status?.startedAt);
}

function inspectWatcher(paths, staleMs = DEFAULT_RUNTIME_STALE_MS) {
  const statusFile = readJsonDetailed(paths.watcherStatusPath);
  if (!statusFile.exists) return { exists: false, path: paths.watcherStatusPath, stale: false, staleReasons: [], ageMs: null, pidAlive: null, status: null };
  if (statusFile.error) return { exists: true, path: paths.watcherStatusPath, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, status: null, error: statusFile.error };
  const intervalMs = Number.parseInt(String(statusFile.value?.intervalMs ?? staleMs), 10);
  const maxAgeMs = Math.max(Number.isFinite(intervalMs) ? intervalMs * 3 : staleMs, staleMs);
  const timestamp = getWatcherTimestamp(statusFile.value);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const pidAlive = isPidAlive(statusFile.value?.pid);
  const staleByAge = ageMs !== null && ageMs >= maxAgeMs;
  const staleByPid = pidAlive === false;
  return {
    exists: true,
    path: paths.watcherStatusPath,
    stale: Boolean(staleByAge || staleByPid || timestamp === null),
    staleReasons: [
      timestamp === null ? 'missing-timestamp' : null,
      staleByAge ? `older-than-${maxAgeMs}ms` : null,
      staleByPid ? 'pid-not-running' : null,
    ].filter(Boolean),
    ageMs,
    pidAlive,
    status: statusFile.value,
  };
}

function getHeartbeatMaxAgeMs(heartbeat) {
  const intervalMs = Number.parseInt(String(heartbeat?.intervalMs ?? 30000), 10);
  return Math.max(Number.isFinite(intervalMs) ? intervalMs * 3 : DEFAULT_HEARTBEAT_TTL_MS, DEFAULT_HEARTBEAT_TTL_MS);
}

function inspectHeartbeatFile(filePath) {
  const heartbeatFile = readJsonDetailed(filePath);
  const agentId = path.basename(filePath, path.extname(filePath));
  if (heartbeatFile.error) return { agentId, path: filePath, exists: true, stale: true, staleReasons: ['malformed-json'], ageMs: null, pidAlive: null, heartbeat: null, error: heartbeatFile.error };
  const heartbeat = heartbeatFile.value;
  const timestamp = parseIsoMs(heartbeat?.lastHeartbeatAt) ?? parseIsoMs(heartbeat?.updatedAt) ?? parseIsoMs(heartbeat?.startedAt);
  const ageMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
  const maxAgeMs = getHeartbeatMaxAgeMs(heartbeat);
  const pidAlive = isPidAlive(heartbeat?.pid);
  const staleByAge = ageMs !== null && ageMs >= maxAgeMs;
  const staleByPid = pidAlive === false;
  return {
    agentId: heartbeat?.agentId || agentId,
    path: filePath,
    exists: true,
    stale: Boolean(staleByAge || staleByPid || timestamp === null),
    staleReasons: [
      timestamp === null ? 'missing-timestamp' : null,
      staleByAge ? `older-than-${maxAgeMs}ms` : null,
      staleByPid ? 'pid-not-running' : null,
    ].filter(Boolean),
    ageMs,
    pidAlive,
    heartbeat,
  };
}

function inspectHeartbeats(paths) {
  if (!fs.existsSync(paths.heartbeatsRoot)) return [];
  return fs.readdirSync(paths.heartbeatsRoot)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => inspectHeartbeatFile(path.join(paths.heartbeatsRoot, entry)));
}

export function buildRuntimeDiagnostics(argv = [], paths) {
  const staleMs = getNumberFlag(argv, '--stale-ms', DEFAULT_RUNTIME_STALE_MS);
  const lock = inspectRuntimeLock(paths, staleMs);
  const watcher = inspectWatcher(paths, staleMs);
  const heartbeats = inspectHeartbeats(paths);
  const staleHeartbeats = heartbeats.filter((entry) => entry.stale);
  const problems = [];
  const suggestions = [];
  if (lock.stale) problems.push(`Runtime lock is stale: ${lock.staleReasons.join(', ')}`);
  if (watcher.stale) problems.push(`Watcher status is stale: ${watcher.staleReasons.join(', ')}`);
  if (staleHeartbeats.length) {
    const details = staleHeartbeats
      .map((entry) => `${entry.agentId}: ${entry.staleReasons.join(', ')}`)
      .join('; ');
    problems.push(`${staleHeartbeats.length} stale heartbeat file(s) found: ${details}`);
  }
  if (!watcher.exists) suggestions.push('Start the watcher with watch-start if automatic stale-work recovery is desired.');
  if (lock.stale || watcher.stale || staleHeartbeats.length) suggestions.push('Run cleanup-runtime --apply after confirming no coordinator command is still running.');
  return { ok: problems.length === 0, staleMs, coordinationRoot: paths.coordinationRoot, lock, watcher, heartbeats, problems, suggestions };
}

function printRuntimeDiagnostics(report, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`# Runtime Diagnostics\n\nCoordination root: ${normalizePath(report.coordinationRoot) || report.coordinationRoot}`);
  console.log(`Lock: ${report.lock.exists ? (report.lock.stale ? `stale (${report.lock.staleReasons.join(', ')})` : 'present') : 'missing'}`);
  console.log(`Watcher: ${report.watcher.exists ? (report.watcher.stale ? `stale (${report.watcher.staleReasons.join(', ')})` : 'present') : 'missing'}`);
  console.log(`Heartbeats: ${report.heartbeats.length} file(s), ${report.heartbeats.filter((entry) => entry.stale).length} stale`);
  console.log('\nProblems:');
  console.log(report.problems.length ? report.problems.map((entry) => `- ${entry}`).join('\n') : '- none');
  console.log('\nSuggestions:');
  console.log(report.suggestions.length ? report.suggestions.map((entry) => `- ${entry}`).join('\n') : '- none');
}

export function runWatchDiagnose(argv, paths) {
  const report = buildRuntimeDiagnostics(argv, paths);
  printRuntimeDiagnostics(report, hasFlag(argv, '--json'));
  return report.ok ? 0 : 1;
}

function cleanupActionFor(kind) {
  if (kind === 'lock') return 'remove-stale-runtime-lock';
  if (kind === 'watcher-status') return 'recover-stale-watcher-status';
  if (kind === 'heartbeat') return 'recover-stale-heartbeat';
  return 'remove-stale-runtime-file';
}

function cleanupDescriptionFor(candidate) {
  if (candidate.kind === 'watcher-status') return 'remove stale watcher status so watch-start can recreate it';
  if (candidate.kind === 'heartbeat') return `remove stale heartbeat for ${candidate.agentId}`;
  if (candidate.kind === 'lock') return 'remove stale runtime lock';
  return 'remove stale runtime file';
}

export function runCleanupRuntime(argv, paths) {
  const apply = hasFlag(argv, '--apply');
  const json = hasFlag(argv, '--json');
  const report = buildRuntimeDiagnostics(argv, paths);
  const candidates = [];
  if (report.lock.exists && report.lock.stale) candidates.push({ kind: 'lock', action: cleanupActionFor('lock'), path: report.lock.path, reasons: report.lock.staleReasons });
  if (report.watcher.exists && report.watcher.stale) candidates.push({ kind: 'watcher-status', action: cleanupActionFor('watcher-status'), path: report.watcher.path, reasons: report.watcher.staleReasons });
  for (const heartbeat of report.heartbeats.filter((entry) => entry.stale)) {
    candidates.push({
      kind: 'heartbeat',
      action: cleanupActionFor('heartbeat'),
      agentId: heartbeat.agentId,
      path: heartbeat.path,
      reasons: heartbeat.staleReasons,
    });
  }
  const recoveryActions = candidates.map((candidate) => ({
    action: candidate.action,
    kind: candidate.kind,
    path: candidate.path,
    agentId: candidate.agentId ?? null,
    reasons: candidate.reasons,
    description: cleanupDescriptionFor(candidate),
  }));
  const removed = [];
  if (apply) {
    withStateTransactionSync(candidates.map((candidate) => candidate.path), () => {
      for (const candidate of candidates) {
        fs.rmSync(candidate.path, { force: true });
        removed.push(candidate);
      }
    });
  }
  const result = {
    ok: true,
    applied: apply,
    candidates,
    recoveryActions,
    recovered: apply ? removed.map((candidate) => ({
      action: candidate.action,
      kind: candidate.kind,
      path: candidate.path,
      agentId: candidate.agentId ?? null,
      reasons: candidate.reasons,
    })) : [],
    removed,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Runtime cleanup applied.' : 'Runtime cleanup dry run.');
    console.log(recoveryActions.length ? recoveryActions.map((entry) => `- ${entry.action}: ${normalizePath(entry.path) || entry.path} (${entry.reasons.join(', ')})`).join('\n') : '- nothing to clean');
  }
  return 0;
}
