#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { bootstrap } from '../../scripts/bootstrap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKIPPED_MINIMAL_COMMANDS = [
  {
    command: 'handoff-ready',
    reason: 'handoff auto-heal can release fixture owners; focused lifecycle tests cover this command.',
  },
];

function runTargetCli(root, args) {
  const cliPath = path.join(root, 'scripts', 'agent-coordination.mjs');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: path.join(root, 'coordination'),
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

function commandRecord(label, args, result, options = {}) {
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const expectedStatus = options.expectedStatus ?? 0;
  const record = {
    label,
    command: options.command ?? args[0],
    args,
    status: result.status,
    expectedStatus,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
  };

  if (result.status !== expectedStatus) {
    throw new Error(`${label} exited ${result.status}, expected ${expectedStatus}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  if (options.json) {
    try {
      record.json = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`${label} did not emit parseable JSON: ${error.message}\nstdout:\n${stdout}`);
    }
  }

  return record;
}

export function runSmokeSuite(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-smoke-'));
  const commands = [];
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'ai-agents-smoke-target', scripts: {} }, null, 2)}\n`);

  try {
    const operations = bootstrap(root, { skipDoctor: true, force: true });

    const run = (label, args, commandOptions = {}) => {
      const result = runTargetCli(root, args);
      const record = commandRecord(label, args, result, commandOptions);
      commands.push(record);
      return record;
    };

    run('init command', ['init']);
    run('doctor fixes starter state', ['doctor', '--fix']);
    run('fixture board apply', ['fixture-board', 'healthy', '--out', 'coordination/board.json', '--apply', '--json'], { json: true });

    for (const [label, args, commandOptions = {}] of [
      ['help minimal', ['help', '--minimal']],
      ['version json', ['version', '--json'], { json: true }],
      ['doctor json', ['doctor', '--json'], { json: true }],
      ['validate json', ['validate', '--json'], { json: true }],
      ['status json', ['status', '--json'], { json: true }],
      ['summarize json', ['summarize', '--json'], { json: true }],
      ['plan dry-run', ['plan', 'Smoke registry coverage']],
      ['inspect board json', ['inspect-board', '--json'], { json: true }],
      ['health score json', ['health-score', '--json'], { json: true }],
      ['prompt json', ['prompt', 'agent-1', '--json'], { json: true }],
      ['ask json', ['ask', 'what can agent-2 do next?', '--json'], { json: true }],
      ['next json', ['next', 'agent-1', '--json'], { json: true }],
      ['handoff bundle json', ['handoff-bundle', 'agent-1', 'task-active', '--json'], { json: true }],
      ['release check json', ['release-check', 'task-done', '--json'], { json: true }],
      ['interactive json', ['interactive', '--json'], { json: true }],
      ['completions list json', ['completions', 'list', '--json'], { json: true }],
      ['archive completed dry-run json', ['archive-completed', '--json'], { json: true }],
    ]) {
      run(label, args, commandOptions);
    }

    run('fixture board blocked apply', ['fixture-board', 'blocked', '--out', 'coordination/board.json', '--apply', '--json'], { json: true });
    run('prioritize dry-run', ['prioritize', 'task-unblocker', '--priority', 'high', '--dry-run']);
    run('start minimal workflow', ['start', 'agent-2', 'task-unblocker', '--paths', 'fixtures/blocked/unblocker.mjs', 'Smoke start']);
    run('progress minimal workflow', ['progress', 'agent-2', 'task-unblocker', 'Smoke progress']);
    run('blocked minimal workflow', ['blocked', 'agent-2', 'task-unblocker', 'Smoke blocked']);
    run('resume minimal workflow', ['resume', 'agent-2', 'task-unblocker', 'Smoke resumed']);
    run('verify minimal workflow', ['verify', 'agent-2', 'task-unblocker', 'unit', 'pass', '--details', 'Smoke verification']);
    run('finish minimal workflow', ['finish', 'agent-2', 'task-unblocker', 'Smoke finished']);
    run('run-check dry-run json', ['run-check', 'smoke', '--dry-run', '--json', '--', process.execPath, '-e', 'console.log("smoke ok")'], { json: true });

    const result = {
      ok: true,
      root,
      packageRoot: REPO_ROOT,
      operations,
      commands: commands.map(({ json, ...entry }) => entry),
      skippedMinimalCommands: SKIPPED_MINIMAL_COMMANDS,
    };

    if (!options.keep) {
      fs.rmSync(root, { recursive: true, force: true });
      result.removed = true;
    }

    return result;
  } catch (error) {
    if (!options.keep) fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function isCliEntrypoint() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}

if (isCliEntrypoint()) {
  const json = process.argv.includes('--json');
  const keep = process.argv.includes('--keep');
  try {
    const result = runSmokeSuite({ keep });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Smoke OK: ${result.commands.length} command(s) passed.`);
      console.log(`Target: ${result.root}${result.removed ? ' (removed)' : ''}`);
    }
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    else console.error(`Smoke failed: ${error.message}`);
    process.exit(1);
  }
}
