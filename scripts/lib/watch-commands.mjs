import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { nowIso } from './file-utils.mjs';

export function createWatchCommands(context) {
  const {
    appendJournalLine,
    applyRecovery,
    buildRecoveryReport,
    clearWatcherStatus,
    coordinationRoot,
    coordinatorScriptPath,
    ensureBaseFiles,
    getBoard,
    getWatcherStatus,
    isWatcherAlive,
    minAgentHeartbeatIntervalMs,
    root,
    saveBoard,
    watchIntervalMs,
    watchLoopScriptPath,
    withMutationLock,
    writeWatcherStatus,
  } = context;

  function renderWatchStatus(status = getWatcherStatus()) {
    if (!status || !isWatcherAlive(status)) {
      return 'Watcher: stopped';
    }

    return [
      'Watcher: running',
      `PID: ${status.pid}`,
      `Started: ${status.startedAt}`,
      `Interval: ${status.intervalMs}ms`,
      `Last heartbeat: ${status.lastHeartbeatAt ?? 'not yet'}`,
      `Last sweep: ${status.lastSweepAt ?? 'not yet'}`,
      `Last auto-heal: ${
        status.lastAutoHeal
          ? `${status.lastAutoHeal.tasks} task(s), ${status.lastAutoHeal.resources} resource(s), ${status.lastAutoHeal.incidents} incident(s) at ${status.lastAutoHeal.at}`
          : 'none'
      }`,
    ].join('\n');
  }

  async function watcherSweep() {
    return withMutationLock(async () => {
      const board = getBoard();
      const report = buildRecoveryReport(board);
      const total = report.staleTasks.length + report.staleResources.length + report.staleIncidents.length;
      const timestamp = nowIso();

      if (total) {
        applyRecovery(board, report, timestamp);
        appendJournalLine(
          `- ${timestamp} | watcher auto-heal: ${report.staleTasks.length} task(s), ${report.staleResources.length} resource(s), ${report.staleIncidents.length} incident(s).`
        );
        await saveBoard(board);
      }

      return {
        at: timestamp,
        tasks: report.staleTasks.length,
        resources: report.staleResources.length,
        incidents: report.staleIncidents.length,
      };
    });
  }

  async function watchTickCommand(options) {
    ensureBaseFiles();
    const watcherPid = Number.parseInt(String(options['watcher-pid'] ?? ''), 10);
    const intervalMs = Number.parseInt(String(options.interval ?? watchIntervalMs), 10);

    if (!Number.isFinite(watcherPid)) {
      throw new Error('Usage: watch-tick --watcher-pid <pid> [--interval <ms>]');
    }

    if (options['dry-run']) {
      console.log(`Dry run: would record watcher tick for pid ${watcherPid}.`);
      return;
    }

    const existingStatus = getWatcherStatus();
    const sweep = await watcherSweep();
    const timestamp = nowIso();

    await writeWatcherStatus({
      pid: watcherPid,
      startedAt: existingStatus?.pid === watcherPid ? existingStatus.startedAt : timestamp,
      intervalMs,
      lastHeartbeatAt: timestamp,
      lastSweepAt: sweep.at,
      lastAutoHeal: sweep.tasks || sweep.resources || sweep.incidents ? sweep : existingStatus?.lastAutoHeal ?? null,
    });
  }

  async function watchCommand(options) {
    ensureBaseFiles();
    const intervalMs = Number.parseInt(String(options.interval ?? watchIntervalMs), 10);

    if (!Number.isFinite(intervalMs) || intervalMs < minAgentHeartbeatIntervalMs) {
      throw new Error(`Usage: watch [--interval <ms>] with interval >= ${minAgentHeartbeatIntervalMs}.`);
    }

    const existingStatus = getWatcherStatus();
    if (isWatcherAlive(existingStatus) && existingStatus.pid !== process.pid) {
      throw new Error(`Watcher already running with pid ${existingStatus.pid}. Use "watch-stop" first if you need to restart it.`);
    }

    if (options['dry-run']) {
      console.log(`Dry run: would run watcher loop every ${intervalMs}ms.`);
      return;
    }

    const startedAt = nowIso();
    await writeWatcherStatus({
      pid: process.pid,
      startedAt,
      intervalMs,
      lastHeartbeatAt: startedAt,
      lastSweepAt: null,
      lastAutoHeal: null,
    });

    const cleanup = () => {
      const status = getWatcherStatus();
      if (status?.pid === process.pid) {
        clearWatcherStatus();
      }
    };

    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    process.on('exit', cleanup);

    console.log(`Watcher started with pid ${process.pid}. Interval ${intervalMs}ms.`);

    while (true) {
      const sweep = await watcherSweep();
      const status = getWatcherStatus();
      if (!status || status.pid !== process.pid) {
        break;
      }

      await writeWatcherStatus({
        ...status,
        pid: process.pid,
        lastHeartbeatAt: nowIso(),
        lastSweepAt: sweep.at,
        lastAutoHeal: sweep.tasks || sweep.resources || sweep.incidents ? sweep : status.lastAutoHeal ?? null,
      });

      await delay(intervalMs);
    }
  }

  async function watchStartCommand(options) {
    await withMutationLock(async () => {
      ensureBaseFiles();
      const existingStatus = getWatcherStatus();

      if (isWatcherAlive(existingStatus)) {
        console.log(`Watcher already running with pid ${existingStatus.pid}.`);
        return;
      }

      if (options['dry-run']) {
        console.log(`Dry run: would start watcher for ${coordinationRoot}.`);
        return;
      }

      const scriptPath = coordinatorScriptPath;
      const watchArgs = [scriptPath, 'watch'];
      if (options.interval) {
        watchArgs.push('--interval', String(options.interval));
      }

      if (process.platform === 'win32') {
        const intervalMs = Number.parseInt(String(options.interval ?? watchIntervalMs), 10);
        const watchLoopPath = watchLoopScriptPath;
        const escapedNodePath = process.execPath.replace(/'/g, "''");
        const escapedScriptPath = scriptPath.replace(/'/g, "''");
        const escapedWatchLoopPath = watchLoopPath.replace(/'/g, "''");
        const escapedRoot = root.replace(/'/g, "''");
        const escapedCoordinationRoot = coordinationRoot.replace(/'/g, "''");
        const startCommand =
          `$proc = Start-Process -FilePath 'powershell.exe' ` +
          `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedWatchLoopPath}','-NodePath','${escapedNodePath}','-CoordinatorScriptPath','${escapedScriptPath}','-WorkspaceRoot','${escapedRoot}','-IntervalMs','${intervalMs}','-CoordinationRoot','${escapedCoordinationRoot}') ` +
          `-WorkingDirectory '${escapedRoot}' -WindowStyle Hidden -PassThru; ` +
          `$proc.Id`;
        const childPid = Number.parseInt(
          execFileSync('powershell.exe', ['-NoProfile', '-Command', startCommand], {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
          }).trim(),
          10
        );

        if (!Number.isFinite(childPid)) {
          throw new Error('Watcher start failed to return a supervisor pid.');
        }

        await writeWatcherStatus({
          pid: childPid,
          startedAt: nowIso(),
          intervalMs,
          lastHeartbeatAt: null,
          lastSweepAt: null,
          lastAutoHeal: null,
        });
      } else {
        const child = spawn(process.execPath, watchArgs, {
          cwd: root,
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            AGENT_COORDINATION_ROOT: coordinationRoot,
            AGENT_COORDINATION_DIR: '',
          },
        });
        child.unref();
      }

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const status = getWatcherStatus();
        if (isWatcherAlive(status)) {
          console.log(`Watcher started with pid ${status.pid}.`);
          return;
        }
        await delay(100);
      }

      throw new Error('Watcher start was requested, but no watcher heartbeat was detected within 5 seconds.');
    });
  }

  function watchStatusCommand() {
    console.log(renderWatchStatus());
  }

  async function watchStopCommand(options = {}) {
    await withMutationLock(async () => {
      const status = getWatcherStatus();

      if (!isWatcherAlive(status)) {
        if (options['dry-run']) {
          console.log('Dry run: would clear stopped watcher status.');
          return;
        }
        clearWatcherStatus();
        console.log('Watcher is not running.');
        return;
      }

      if (options['dry-run']) {
        console.log(`Dry run: would stop watcher ${status.pid}.`);
        return;
      }

      process.kill(status.pid, 'SIGTERM');
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!isWatcherAlive(getWatcherStatus())) {
          clearWatcherStatus();
          console.log(`Watcher ${status.pid} stopped.`);
          return;
        }
        await delay(100);
      }

      throw new Error(`Watcher ${status.pid} did not stop within 5 seconds.`);
    });
  }

  return {
    watchCommand,
    watchStartCommand,
    watchStatusCommand,
    watchStopCommand,
    watchTickCommand,
  };
}
