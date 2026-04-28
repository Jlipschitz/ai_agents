import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInteractiveModel, runInteractive } from '../scripts/lib/interactive-commands.mjs';

function makeOutput() {
  let text = '';
  return {
    stream: {
      write(chunk) {
        text += chunk;
      },
    },
    text() {
      return text;
    },
  };
}

const board = {
  projectName: 'Interactive Test',
  tasks: [
    { id: 'task-active', status: 'active' },
    { id: 'task-planned', status: 'planned' },
    { id: 'task-review', status: 'review' },
  ],
};

test('interactive model includes contextual actions from board state', () => {
  const model = buildInteractiveModel({ board });

  assert.equal(model.projectName, 'Interactive Test');
  assert.deepEqual(model.taskCounts, { active: 1, planned: 1, review: 1 });
  assert.ok(model.actions.some((action) => action.id === 'pick'));
  assert.ok(model.actions.some((action) => action.id === 'review'));
  assert.ok(model.actions.some((action) => action.id === 'risk'));
});

test('interactive command renders a non-tty menu without mutating', async () => {
  const output = makeOutput();
  const status = await runInteractive([], { board, stdout: output.stream, stdin: { isTTY: false }, cli: 'agents' });

  assert.equal(status, 0);
  assert.match(output.text(), /# Interactive Mode/);
  assert.match(output.text(), /agents -- status/);
});

test('interactive command prints selected command by id or number', async () => {
  const byId = makeOutput();
  const byNumber = makeOutput();

  assert.equal(await runInteractive(['--select', 'review'], { board, stdout: byId.stream, stdin: { isTTY: false }, cli: 'agents' }), 0);
  assert.equal(await runInteractive(['--select', '1'], { board, stdout: byNumber.stream, stdin: { isTTY: false }, cli: 'agents' }), 0);

  assert.equal(byId.text(), 'agents -- review-queue\n');
  assert.equal(byNumber.text(), 'agents -- status\n');
});
