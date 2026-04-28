import test from 'node:test';
import assert from 'node:assert/strict';

import { getFlagValue, getNumberFlag, getPositionals, hasFlag } from '../scripts/lib/args-utils.mjs';

test('shared arg helpers support split and inline flag values', () => {
  const argv = ['--json=true', '--from=BACKLOG.md', '--owner', 'agent-1', '--limit=25', 'positional'];

  assert.equal(hasFlag(argv, '--json'), true);
  assert.equal(hasFlag(argv, '--from'), true);
  assert.equal(hasFlag(argv, '--missing'), false);
  assert.equal(getFlagValue(argv, '--from'), 'BACKLOG.md');
  assert.equal(getFlagValue(argv, '--owner'), 'agent-1');
  assert.equal(getFlagValue(argv, '--missing', 'fallback'), 'fallback');
  assert.equal(getNumberFlag(argv, '--limit', 10), 25);
  assert.deepEqual(getPositionals(argv, new Set(['--from', '--owner', '--limit'])), ['positional']);
});
