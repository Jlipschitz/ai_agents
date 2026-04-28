import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentConfigWithSources, validateAgentConfig } from '../scripts/validate-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const examplesRoot = path.join(repoRoot, 'examples');

function listExampleDirs() {
  return fs.readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(examplesRoot, entry.name))
    .sort();
}

test('example repos include valid coordination configs and starter docs', () => {
  const exampleDirs = listExampleDirs();
  assert.deepEqual(exampleDirs.map((dir) => path.basename(dir)), ['basic-node', 'docs-only', 'react-app']);

  for (const exampleDir of exampleDirs) {
    const configPath = path.join(exampleDir, 'agent-coordination.config.json');
    const packagePath = path.join(exampleDir, 'package.json');
    const readmePath = path.join(exampleDir, 'README.md');
    const appNotesPath = path.join(exampleDir, 'docs', 'ai-agent-app-notes.md');

    assert.equal(fs.existsSync(configPath), true, `${configPath} exists`);
    assert.equal(fs.existsSync(packagePath), true, `${packagePath} exists`);
    assert.equal(fs.existsSync(readmePath), true, `${readmePath} exists`);
    assert.equal(fs.existsSync(appNotesPath), true, `${appNotesPath} exists`);

    const { config } = loadAgentConfigWithSources(configPath, { root: exampleDir });
    const result = validateAgentConfig(config, { root: exampleDir });
    assert.deepEqual(result.errors, [], `${path.basename(exampleDir)} config errors`);
    assert.equal(result.valid, true);

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.scripts.agents, 'node ./scripts/agent-coordination.mjs');
    assert.equal(packageJson.scripts['agents:doctor'], 'node ./scripts/agent-coordination.mjs doctor');
  }
});
