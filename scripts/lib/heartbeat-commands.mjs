import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { isPidAlive, nowIso } from './file-utils.mjs';

export function createHeartbeatCommands(context) {
  const {
    agentHeartbeatIntervalMs,
    appendJournalLine,
    clearAgentHeartbeat,
    coordinationLabel,
    coordinationRoot,
    coordinatorScriptPath,
    getAgent,
    getAgentHeartbeatPath,
    getBoard,
    getBoardSnapshot,
    getTask,
    minAgentHeartbeatIntervalMs,
    readAgentHeartbeat,
    readAgentHeartbeats,
    readJson,
    renderHeartbeatLine,
    root,
    runtimeRoot,
    terminalId,
    writeAgentHeartbeatSync,
  } = context;

  function parseIntervalMs(value, fallbackMs, usage) {
    const intervalMs = Number.parseInt(String(value ?? fallbackMs), 10);
    if (!Number.isFinite(intervalMs) || intervalMs < minAgentHeartbeatIntervalMs) {
      throw new Error(`${usage} with interval >= ${minAgentHeartbeatIntervalMs}.`);
    }
    return intervalMs;
  }

  function buildAgentHeartbeatRecord(agentId, intervalMs, existingHeartbeat = null, command = 'heartbeat') {
    const timestamp = nowIso();
    const board = getBoardSnapshot();
    const agent = board?.agents.find((entry) => entry.id === agentId) ?? null;
    const task = agent?.taskId ? getTask(board, agent.taskId) : null;

    return {
      agentId,
      pid: process.pid,
      terminalId,
      startedAt: existingHeartbeat?.pid === process.pid && existingHeartbeat?.startedAt ? existingHeartbeat.startedAt : timestamp,
      lastHeartbeatAt: timestamp,
      intervalMs,
      taskId: agent?.taskId ?? null,
      taskStatus: task?.status ?? null,
      boardUpdatedAt: board?.updatedAt ?? null,
      workspace: coordinationLabel,
      command,
    };
  }

  function heartbeatStatusCommand(positionals) {
    const [agentId] = positionals;

    if (agentId) {
      getAgent(getBoard(), agentId);
    }

    const heartbeats = readAgentHeartbeats(nowIso(), { cleanupStale: false });
    if (agentId) {
      const heartbeat = heartbeats.get(agentId);
      console.log(
        heartbeat
          ? renderHeartbeatLine(heartbeat)
          : `No live heartbeat for ${agentId}.${terminalId ? ` Current terminal: ${terminalId}.` : ''}`
      );
      return;
    }

    if (!heartbeats.size) {
      console.log(`No live heartbeats.${terminalId ? ` Current terminal: ${terminalId}.` : ''}`);
      return;
    }

    const lines = [];
    if (terminalId) {
      lines.push(`Current terminal: ${terminalId}`);
    }
    lines.push(...[...heartbeats.values()].map((heartbeat) => renderHeartbeatLine(heartbeat)));
    console.log(lines.join('\n'));
  }

  async function heartbeatCommand(positionals, options) {
    const [agentId] = positionals;
    const intervalMs = parseIntervalMs(options.interval, agentHeartbeatIntervalMs, 'Usage: heartbeat <agent> [--interval <ms>]');

    if (!agentId) {
      throw new Error('Usage: heartbeat <agent> [--interval <ms>]');
    }

    getAgent(getBoard(), agentId);
    const existingHeartbeat = readAgentHeartbeat(agentId);
    if (existingHeartbeat && existingHeartbeat.pid !== process.pid) {
      throw new Error(`Heartbeat already running for ${agentId} with pid ${existingHeartbeat.pid}. Stop it first if you need to replace it.`);
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      appendJournalLine(`- ${nowIso()} | heartbeat stopped for ${agentId}${terminalId ? ` in ${terminalId}` : ''}.`);
      clearAgentHeartbeat(agentId, process.pid);
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

    const initialHeartbeat = buildAgentHeartbeatRecord(agentId, intervalMs, existingHeartbeat, 'heartbeat');
    writeAgentHeartbeatSync(agentId, initialHeartbeat);
    appendJournalLine(`- ${initialHeartbeat.lastHeartbeatAt} | heartbeat started for ${agentId}${terminalId ? ` in ${terminalId}` : ''}.`);
    console.log(`Heartbeat started for ${agentId} with pid ${process.pid}.${terminalId ? ` Terminal ${terminalId}.` : ''}`);

    while (true) {
      const nextHeartbeat = buildAgentHeartbeatRecord(agentId, intervalMs, initialHeartbeat, 'heartbeat');
      writeAgentHeartbeatSync(agentId, nextHeartbeat);
      await delay(intervalMs);
    }
  }

  async function heartbeatStartCommand(positionals, options) {
    const [agentId] = positionals;
    const intervalMs = parseIntervalMs(
      options.interval,
      agentHeartbeatIntervalMs,
      'Usage: heartbeat-start <agent> [--interval <ms>]'
    );

    if (!agentId) {
      throw new Error('Usage: heartbeat-start <agent> [--interval <ms>]');
    }

    getAgent(getBoard(), agentId);
    const existingHeartbeat = readAgentHeartbeat(agentId);
    if (existingHeartbeat) {
      console.log(`Heartbeat already running for ${agentId} with pid ${existingHeartbeat.pid}.`);
      return;
    }

    const scriptPath = coordinatorScriptPath;
    const heartbeatOutPath = path.join(runtimeRoot, `${agentId}.heartbeat.out.log`);
    const heartbeatErrPath = path.join(runtimeRoot, `${agentId}.heartbeat.err.log`);
    let childPid = null;

    if (process.platform === 'win32') {
      const escapedNodePath = process.execPath.replace(/'/g, "''");
      const escapedScriptPath = scriptPath.replace(/'/g, "''");
      const escapedRoot = root.replace(/'/g, "''");
      const escapedCoordinationRoot = coordinationRoot.replace(/'/g, "''");
      const escapedTerminalId = (terminalId ?? '').replace(/'/g, "''");
      const escapedOutPath = heartbeatOutPath.replace(/'/g, "''");
      const escapedErrPath = heartbeatErrPath.replace(/'/g, "''");
      const startCommand =
        `$env:AGENT_COORDINATION_ROOT='${escapedCoordinationRoot}'; ` +
        `$env:AGENT_COORDINATION_DIR=''; ` +
        `$env:AGENT_TERMINAL_ID='${escapedTerminalId}'; ` +
        `$proc = Start-Process -FilePath '${escapedNodePath}' ` +
        `-ArgumentList @('${escapedScriptPath}','heartbeat','${agentId}','--interval','${intervalMs}') ` +
        `-WorkingDirectory '${escapedRoot}' -WindowStyle Hidden ` +
        `-RedirectStandardOutput '${escapedOutPath}' -RedirectStandardError '${escapedErrPath}' -PassThru; ` +
        `$proc.Id`;
      childPid = Number.parseInt(
        execFileSync('powershell.exe', ['-NoProfile', '-Command', startCommand], {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
        }).trim(),
        10
      );
    } else {
      const outFd = fs.openSync(heartbeatOutPath, 'a');
      const errFd = fs.openSync(heartbeatErrPath, 'a');
      const child = spawn(process.execPath, [scriptPath, 'heartbeat', agentId, '--interval', String(intervalMs)], {
        cwd: root,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
        env: {
          ...process.env,
          AGENT_COORDINATION_ROOT: coordinationRoot,
          AGENT_COORDINATION_DIR: '',
          ...(terminalId ? { AGENT_TERMINAL_ID: terminalId } : {}),
        },
      });
      child.unref();
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      childPid = child.pid;
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const heartbeat = readAgentHeartbeat(agentId);
      if (heartbeat && heartbeat.pid === childPid) {
        console.log(`Heartbeat started for ${agentId} with pid ${heartbeat.pid}.${heartbeat.terminalId ? ` Terminal ${heartbeat.terminalId}.` : ''}`);
        return;
      }
      await delay(100);
    }

    throw new Error(`Heartbeat start was requested for ${agentId}, but no heartbeat was detected within 5 seconds.`);
  }

  async function heartbeatStopCommand(positionals) {
    const [agentId] = positionals;

    if (!agentId) {
      throw new Error('Usage: heartbeat-stop <agent>');
    }

    getAgent(getBoard(), agentId);
    const heartbeat = readJson(getAgentHeartbeatPath(agentId), null);

    if (!heartbeat || typeof heartbeat.pid !== 'number' || !isPidAlive(heartbeat.pid)) {
      clearAgentHeartbeat(agentId);
      appendJournalLine(`- ${nowIso()} | heartbeat cleared for ${agentId} because no live process was found.`);
      console.log(`Heartbeat is not running for ${agentId}.`);
      return;
    }

    process.kill(heartbeat.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const liveHeartbeat = readAgentHeartbeat(agentId);
      if (!liveHeartbeat || liveHeartbeat.pid !== heartbeat.pid) {
        clearAgentHeartbeat(agentId, heartbeat.pid);
        appendJournalLine(`- ${nowIso()} | heartbeat stopped for ${agentId}.`);
        console.log(`Heartbeat ${heartbeat.pid} stopped for ${agentId}.`);
        return;
      }
      await delay(100);
    }

    throw new Error(`Heartbeat ${heartbeat.pid} for ${agentId} did not stop within 5 seconds.`);
  }

  return {
    heartbeatCommand,
    heartbeatStartCommand,
    heartbeatStatusCommand,
    heartbeatStopCommand,
  };
}
