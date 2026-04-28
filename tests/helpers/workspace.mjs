import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '..', '..');
export const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
export const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

export function coordinationRoot(root, coordinationDir = 'coordination') {
  return path.join(root, coordinationDir);
}

export function makeWorkspace(options = {}) {
  const {
    prefix = 'ai-agents-test-',
    packageName = 'test-repo',
    config = true,
    runtime = false,
    heartbeatRuntime = false,
    board,
  } = options;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const rootCoordination = coordinationRoot(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  if (runtime) fs.mkdirSync(path.join(rootCoordination, 'runtime'), { recursive: true });
  if (heartbeatRuntime) fs.mkdirSync(path.join(rootCoordination, 'runtime', 'agent-heartbeats'), { recursive: true });
  if (config) fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(validConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: packageName, scripts: {} }, null, 2));
  if (board) writeBoard(root, board);
  return { root, coordinationRoot: rootCoordination, configPath: path.join(root, 'agent-coordination.config.json') };
}

export function writeBoard(root, board, options = {}) {
  const rootCoordination = options.coordinationRoot ?? coordinationRoot(root);
  fs.mkdirSync(rootCoordination, { recursive: true });
  fs.writeFileSync(path.join(rootCoordination, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
  fs.writeFileSync(path.join(rootCoordination, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(rootCoordination, 'messages.ndjson'), '');
}

export function runCli(root, args, options = {}) {
  const rootCoordination = options.coordinationRoot ?? coordinationRoot(root);
  return spawnSync(process.execPath, [options.cliPath ?? cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: rootCoordination,
      AGENT_COORDINATION_CONFIG: options.configPath ?? path.join(root, 'agent-coordination.config.json'),
      ...(options.env ?? {}),
    },
  });
}

export function runWithoutCoordinationEnv(cli, root, args) {
  const env = { ...process.env };
  delete env.AGENT_COORDINATION_ROOT;
  delete env.AGENT_COORDINATION_DIR;
  delete env.AGENT_COORDINATION_CONFIG;
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

export function snapshotFiles(paths) {
  return Object.fromEntries(paths.map((filePath) => [filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null]));
}
