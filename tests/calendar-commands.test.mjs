import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeWorkspace, runCli, writeBoard } from './helpers/workspace.mjs';

function makeCalendarWorkspace() {
  const workspace = makeWorkspace({ prefix: 'ai-agents-calendar-', packageName: 'calendar-test', runtime: true });
  writeBoard(workspace.root, {
    projectName: 'Calendar Test',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-ui',
        status: 'planned',
        ownerId: 'agent-1',
        title: 'Build UI',
        summary: 'Build the dashboard UI',
        claimedPaths: ['app/page.tsx'],
        priority: 'high',
        severity: 'medium',
        dueAt: '2026-05-01T15:00:00.000Z',
      },
      {
        id: 'task-api',
        status: 'active',
        ownerId: 'agent-2',
        title: 'Ship API',
        claimedPaths: ['api/routes.ts'],
        priority: 'urgent',
        severity: 'critical',
        dueAt: '2026-05-02T18:30:00.000Z',
      },
      {
        id: 'task-done',
        status: 'done',
        ownerId: 'agent-3',
        title: 'Done task',
        claimedPaths: ['docs/done.md'],
        dueAt: '2026-05-03T00:00:00.000Z',
      },
      {
        id: 'task-undated',
        status: 'planned',
        ownerId: null,
        title: 'No due date',
        claimedPaths: ['docs/later.md'],
      },
    ],
  });
  return workspace;
}

test('calendar exports active due tasks as iCalendar reminders', () => {
  const { root, coordinationRoot } = makeCalendarWorkspace();
  const result = runCli(root, ['calendar', '--json', '--reminder-minutes', '60,15'], { coordinationRoot });
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(payload.applied, false);
  assert.deepEqual(payload.tasks.map((task) => task.taskId), ['task-ui', 'task-api']);
  assert.match(payload.ics, /BEGIN:VCALENDAR/);
  assert.match(payload.ics, /BEGIN:VEVENT/);
  assert.match(payload.ics, /BEGIN:VALARM/);
  assert.match(payload.ics, /TRIGGER:-PT60M/);
  assert.match(payload.ics, /TRIGGER:-PT15M/);
  assert.match(payload.ics, /SUMMARY:\[high\] Build UI/);
  assert.doesNotMatch(payload.ics, /task-done/);
});

test('calendar can include terminal tasks and write the ics file only with apply', () => {
  const { root, coordinationRoot } = makeCalendarWorkspace();
  const relativeOutput = 'coordination/calendar/tasks.ics';
  const outputPath = path.join(root, relativeOutput);

  const dryRun = runCli(root, ['calendar', 'export', '--all', '--out', relativeOutput, '--json'], { coordinationRoot });
  const dryPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(dryPayload.applied, false);
  assert.deepEqual(dryPayload.tasks.map((task) => task.taskId), ['task-ui', 'task-api', 'task-done']);
  assert.equal(fs.existsSync(outputPath), false);

  const applied = runCli(root, ['calendar', 'export', '--all', '--out', relativeOutput, '--apply', '--json'], { coordinationRoot });
  const appliedPayload = JSON.parse(applied.stdout);
  const content = fs.readFileSync(outputPath, 'utf8');

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(appliedPayload.applied, true);
  assert.match(content, /BEGIN:VCALENDAR/);
  assert.match(content, /task-done/);
});
