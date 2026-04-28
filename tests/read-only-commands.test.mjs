import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'agent-coordination.mjs');
const validConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent-coordination.config.json'), 'utf8'));

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agents-readonly-'));
  const coordinationRoot = path.join(root, 'coordination');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(coordinationRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent-coordination.config.json'), `${JSON.stringify(validConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(coordinationRoot, 'board.json'), JSON.stringify({
    projectName: 'Read Only Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      { id: 'task-active', status: 'active', ownerId: 'agent-1', title: 'Active task', claimedPaths: ['src/a'] },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(coordinationRoot, 'journal.md'), '# Journal\n\n');
  fs.writeFileSync(path.join(coordinationRoot, 'messages.ndjson'), '');
  return { root, coordinationRoot };
}

function snapshotFiles(paths) {
  return Object.fromEntries(paths.map((filePath) => [filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null]));
}

function run(root, coordinationRoot, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_COORDINATION_ROOT: coordinationRoot,
      AGENT_COORDINATION_CONFIG: path.join(root, 'agent-coordination.config.json'),
    },
  });
}

for (const args of [
  ['summarize'],
  ['summarize', '--for-chat'],
  ['summarize', '--json'],
  ['validate', '--json'],
  ['doctor', '--json'],
]) {
  test(`${args.join(' ')} does not mutate coordination state`, () => {
    const { root, coordinationRoot } = makeWorkspace();
    const files = [
      path.join(coordinationRoot, 'board.json'),
      path.join(coordinationRoot, 'journal.md'),
      path.join(coordinationRoot, 'messages.ndjson'),
    ];
    const before = snapshotFiles(files);
    const result = run(root, coordinationRoot, args);
    const after = snapshotFiles(files);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(after, before);
  });
}
