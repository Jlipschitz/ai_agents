import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { appendAuditLog } from './audit-log.mjs';
import { nowIso, readJsonSafe, writeJson } from './file-utils.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';
import { writePreMutationWorkspaceSnapshot } from './workspace-snapshot-commands.mjs';

const DEFAULT_SOURCES = ['README.md', 'docs'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coordination', 'coordination-two', 'artifacts']);

function sourcePaths(argv) {
  const raw = getFlagValue(argv, '--from', DEFAULT_SOURCES.join(','));
  return raw.split(',').map((entry) => normalizePath(entry)).filter(Boolean);
}

function listMarkdownFiles(root, sourcePath) {
  const absolutePath = resolveRepoPath(sourcePath, sourcePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return /\.md$/i.test(absolutePath) ? [absolutePath] : [];
  if (!stat.isDirectory()) return [];

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) return [];
        return listMarkdownFiles(root, path.join(sourcePath, entry.name));
      }
      const filePath = path.join(absolutePath, entry.name);
      return entry.isFile() && /\.md$/i.test(entry.name) ? [filePath] : [];
    });
}

function cleanTodoText(text) {
  return text.replace(/\s+#.*$/, '').replace(/\s+/g, ' ').trim();
}

function parseTodoLine(line) {
  const taskList = line.match(/^\s*[-*]\s+\[\s\]\s+(.+)$/);
  if (taskList) return cleanTodoText(taskList[1]);
  const todo = line.match(/\bTODO[:\s-]+(.+)$/i);
  return todo ? cleanTodoText(todo[1]) : '';
}

function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/g, '');
  return slug || fallback;
}

function taskIdFor(relativePath, lineNumber, text) {
  return `backlog-${slugify(relativePath.replace(/\.md$/i, ''))}-${lineNumber}-${slugify(text, 'todo').slice(0, 24)}`;
}

function taskFromTodo(todo, ownerId) {
  const timestamp = nowIso();
  return {
    id: todo.taskId,
    title: todo.text,
    summary: todo.text,
    status: 'planned',
    ownerId: null,
    suggestedOwnerId: ownerId || null,
    claimedPaths: [todo.path],
    dependencies: [],
    waitingOn: [],
    verification: [],
    verificationLog: [],
    notes: [],
    relevantDocs: [todo.path],
    docsReviewedAt: null,
    docsReviewedBy: null,
    importSource: { type: 'markdown-todo', path: todo.path, line: todo.line },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function collectTodos(root, argv) {
  const files = [...new Set(sourcePaths(argv).flatMap((entry) => listMarkdownFiles(root, entry)))];
  return files.flatMap((filePath) => {
    const relative = normalizePath(path.relative(root, filePath));
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .map(({ line, lineNumber }) => ({ text: parseTodoLine(line), line: lineNumber, path: relative }))
      .filter((todo) => todo.text)
      .map((todo) => ({ ...todo, taskId: taskIdFor(todo.path, todo.line, todo.text) }));
  });
}

function hasExistingImport(tasks, todo) {
  return tasks.some((task) =>
    task.id === todo.taskId
    || (task.importSource?.type === 'markdown-todo' && task.importSource.path === todo.path && task.importSource.line === todo.line)
  );
}

export function buildBacklogImportPlan(argv, context) {
  const board = readJsonSafe(context.paths.boardPath, { version: 1, projectName: context.config.projectName || path.basename(context.root), tasks: [] });
  board.tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const ownerId = getFlagValue(argv, '--owner', '');
  const todos = collectTodos(context.root, argv);
  const candidates = todos.map((todo) => ({ ...todo, exists: hasExistingImport(board.tasks, todo) }));
  const newTasks = candidates.filter((todo) => !todo.exists).map((todo) => taskFromTodo(todo, ownerId));

  return {
    ok: true,
    applied: false,
    sourcePaths: sourcePaths(argv),
    candidates,
    newTasks,
    board,
    workspaceSnapshotPath: null,
  };
}

export function runBacklogImport(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildBacklogImportPlan(argv, context);

  if (apply && plan.newTasks.length) {
    plan.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, 'backlog-import');
    plan.board.tasks.push(...plan.newTasks);
    plan.board.updatedAt = nowIso();
    writeJson(context.paths.boardPath, plan.board);
    appendAuditLog(context.paths, {
      command: 'backlog-import',
      applied: true,
      summary: `Imported ${plan.newTasks.length} Markdown backlog task(s).`,
      details: { taskIds: plan.newTasks.map((task) => task.id), sourcePaths: plan.sourcePaths, workspaceSnapshotPath: plan.workspaceSnapshotPath },
    });
    plan.applied = true;
  }

  const result = {
    ok: true,
    applied: plan.applied,
    sourcePaths: plan.sourcePaths,
    importedTaskIds: plan.newTasks.map((task) => task.id),
    skippedExistingTaskIds: plan.candidates.filter((todo) => todo.exists).map((todo) => todo.taskId),
    candidates: plan.candidates.map((todo) => ({ path: todo.path, line: todo.line, text: todo.text, taskId: todo.taskId, exists: todo.exists })),
    workspaceSnapshotPath: plan.workspaceSnapshotPath,
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Backlog import applied.' : 'Backlog import dry run.');
    console.log(result.importedTaskIds.length ? result.importedTaskIds.map((id) => `- ${id}`).join('\n') : '- no new backlog tasks');
    if (result.workspaceSnapshotPath) console.log(`Workspace snapshot: ${normalizePath(result.workspaceSnapshotPath) || result.workspaceSnapshotPath}`);
  }

  return 0;
}
