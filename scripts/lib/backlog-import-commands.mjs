import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { appendAuditLog, auditLogPath } from './audit-log.mjs';
import { createStarterBoard } from './board-migration.mjs';
import { CliError } from './error-formatting.mjs';
import { nowIso, readJsonSafe, writeJson } from './file-utils.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';
import { taskMetadataFromArgv } from './task-metadata.mjs';
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

function githubTaskIdFor(repository, number, title) {
  return `backlog-github-${slugify(repository.replace('/', '-'))}-${number}-${slugify(title, 'issue').slice(0, 24)}`;
}

function normalizeGithubRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new CliError('Usage: backlog-import --github-issues OWNER/REPO [--apply] [--json]', {
      code: 'usage_error',
      hint: 'Pass a GitHub repository in owner/name form.',
      exitCode: 1,
    });
  }
  return repository;
}

function parseJsonArrayEnv(name) {
  const raw = process.env[name];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed;
  } catch {
    // Fall through to the stable configuration error below.
  }
  throw new CliError(`${name} must be a JSON array of strings.`, { code: 'usage_error', exitCode: 1 });
}

function ghInvocation() {
  return {
    command: process.env.BACKLOG_IMPORT_GH_PATH || 'gh',
    prefixArgs: parseJsonArrayEnv('BACKLOG_IMPORT_GH_ARGS'),
  };
}

function runGhJson(args) {
  const { command, prefixArgs } = ghInvocation();
  const result = spawnSync(command, [...prefixArgs, ...args], {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`Failed to run gh: ${result.error.message}`, {
      code: 'github_import_error',
      hint: 'Install and authenticate the GitHub CLI, or set BACKLOG_IMPORT_GH_PATH for tests.',
      exitCode: 1,
    });
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new CliError(`gh issue list failed${detail ? `: ${detail}` : ''}`, {
      code: 'github_import_error',
      exitCode: result.status || 1,
    });
  }

  try {
    return JSON.parse(result.stdout || '[]');
  } catch (error) {
    throw new CliError(`gh issue list returned invalid JSON: ${error.message}`, {
      code: 'parse_error',
      exitCode: 1,
    });
  }
}

function taskFromTodo(todo, ownerId, metadata) {
  const timestamp = nowIso();
  return {
    id: todo.taskId,
    title: todo.text,
    summary: todo.text,
    status: 'planned',
    ownerId: null,
    suggestedOwnerId: ownerId || null,
    rationale: '',
    effort: 'unknown',
    ...metadata,
    issueKey: null,
    claimedPaths: [todo.path],
    dependencies: [],
    waitingOn: [],
    verification: [],
    verificationLog: [],
    notes: [],
    relevantDocs: [todo.path],
    docsReviewedAt: null,
    docsReviewedBy: null,
    lastOwnerId: null,
    lastHandoff: null,
    importSource: { type: 'markdown-todo', path: todo.path, line: todo.line },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function compactIssueBody(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

function labelsFromIssue(issue) {
  return Array.isArray(issue.labels)
    ? issue.labels.map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean).sort()
    : [];
}

function assigneesFromIssue(issue) {
  return Array.isArray(issue.assignees)
    ? issue.assignees.map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login).filter(Boolean).sort()
    : [];
}

function taskFromGithubIssue(issue, ownerId, metadata) {
  const timestamp = nowIso();
  const bodySummary = compactIssueBody(issue.body);
  const labels = labelsFromIssue(issue);
  const assignees = assigneesFromIssue(issue);
  return {
    id: issue.taskId,
    title: issue.title,
    summary: bodySummary || issue.title,
    status: 'planned',
    ownerId: null,
    suggestedOwnerId: ownerId || null,
    rationale: '',
    effort: 'unknown',
    ...metadata,
    issueKey: `${issue.repository}#${issue.number}`,
    claimedPaths: [],
    dependencies: [],
    waitingOn: [],
    verification: [],
    verificationLog: [],
    notes: [],
    relevantDocs: [],
    docsReviewedAt: null,
    docsReviewedBy: null,
    lastOwnerId: null,
    lastHandoff: null,
    importSource: {
      type: 'github-issue',
      repository: issue.repository,
      number: issue.number,
      url: issue.url || null,
      state: issue.state || null,
      title: issue.title,
      labels,
      assignees,
      author: issue.author?.login || null,
      createdAt: issue.createdAt || null,
      updatedAt: issue.updatedAt || null,
    },
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

function collectGithubIssues(argv) {
  const repository = normalizeGithubRepository(getFlagValue(argv, '--github-issues'));
  const state = getFlagValue(argv, '--github-state', 'open');
  const limit = getFlagValue(argv, '--github-limit', '100');
  const issues = runGhJson([
    'issue',
    'list',
    '--repo',
    repository,
    '--state',
    state,
    '--limit',
    limit,
    '--json',
    'number,title,body,state,url,labels,assignees,author,createdAt,updatedAt',
  ]);
  if (!Array.isArray(issues)) {
    throw new CliError('gh issue list returned JSON that was not an array.', { code: 'parse_error', exitCode: 1 });
  }

  return issues
    .filter((issue) => Number.isFinite(Number(issue?.number)) && String(issue?.title || '').trim())
    .map((issue) => ({
      ...issue,
      number: Number(issue.number),
      title: String(issue.title).trim(),
      repository,
      taskId: githubTaskIdFor(repository, issue.number, issue.title),
    }));
}

function hasExistingImport(tasks, todo) {
  return tasks.some((task) =>
    task.id === todo.taskId
    || (task.importSource?.type === 'markdown-todo' && task.importSource.path === todo.path && task.importSource.line === todo.line)
  );
}

function hasExistingGithubImport(tasks, issue) {
  return tasks.some((task) =>
    task.id === issue.taskId
    || task.issueKey === `${issue.repository}#${issue.number}`
    || (
      task.importSource?.type === 'github-issue'
      && task.importSource.repository === issue.repository
      && Number(task.importSource.number) === issue.number
    )
  );
}

export function buildBacklogImportPlan(argv, context) {
  const board = readJsonSafe(context.paths.boardPath, createStarterBoard(context));
  board.tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const ownerId = getFlagValue(argv, '--owner', '');
  const metadata = taskMetadataFromArgv(argv, { getFlagValue, hasFlag, includeDefaults: true });
  const githubImport = hasFlag(argv, '--github-issues');
  const sourceType = githubImport ? 'github-issues' : 'markdown';
  const sourcePathsForPlan = githubImport ? [] : sourcePaths(argv);
  const githubRepository = githubImport ? normalizeGithubRepository(getFlagValue(argv, '--github-issues')) : null;
  const candidates = githubImport
    ? collectGithubIssues(argv).map((issue) => ({ ...issue, exists: hasExistingGithubImport(board.tasks, issue) }))
    : collectTodos(context.root, argv).map((todo) => ({ ...todo, exists: hasExistingImport(board.tasks, todo) }));
  const newTasks = githubImport
    ? candidates.filter((issue) => !issue.exists).map((issue) => taskFromGithubIssue(issue, ownerId, metadata))
    : candidates.filter((todo) => !todo.exists).map((todo) => taskFromTodo(todo, ownerId, metadata));

  return {
    ok: true,
    applied: false,
    sourceType,
    sourcePaths: sourcePathsForPlan,
    githubRepository,
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
    withStateTransactionSync([context.paths.boardPath, context.paths.snapshotsRoot, auditLogPath(context.paths)], () => {
      plan.workspaceSnapshotPath = writePreMutationWorkspaceSnapshot(context.paths, 'backlog-import');
      plan.board.tasks.push(...plan.newTasks);
      plan.board.updatedAt = nowIso();
      writeJson(context.paths.boardPath, plan.board);
      appendAuditLog(context.paths, {
        command: 'backlog-import',
        applied: true,
        summary: `Imported ${plan.newTasks.length} ${plan.sourceType === 'github-issues' ? 'GitHub issue' : 'Markdown backlog'} task(s).`,
        details: {
          taskIds: plan.newTasks.map((task) => task.id),
          sourceType: plan.sourceType,
          sourcePaths: plan.sourcePaths,
          githubRepository: plan.githubRepository,
          workspaceSnapshotPath: plan.workspaceSnapshotPath,
        },
      });
    });
    plan.applied = true;
  }

  const result = {
    ok: true,
    applied: plan.applied,
    sourceType: plan.sourceType,
    sourcePaths: plan.sourcePaths,
    githubRepository: plan.githubRepository,
    importedTaskIds: plan.newTasks.map((task) => task.id),
    skippedExistingTaskIds: plan.candidates.filter((todo) => todo.exists).map((todo) => todo.taskId),
    candidates: plan.candidates.map((candidate) => plan.sourceType === 'github-issues'
      ? {
          repository: candidate.repository,
          number: candidate.number,
          title: candidate.title,
          url: candidate.url || null,
          taskId: candidate.taskId,
          exists: candidate.exists,
        }
      : { path: candidate.path, line: candidate.line, text: candidate.text, taskId: candidate.taskId, exists: candidate.exists }),
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
