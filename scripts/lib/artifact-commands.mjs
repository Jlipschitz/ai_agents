import fs from 'node:fs';
import path from 'node:path';

import { printCommandError } from './error-formatting.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';

export function createArtifactCommands(context) {
  const {
    activeStatuses,
    defaultArtifactPolicy,
    fileTimestamp,
    getCoordinationPaths,
    getFlagValue,
    getNumberFlag,
    getPositionals,
    hasFlag,
    loadConfig,
    normalizePath,
    readJsonSafe,
    resolveRepoPath,
    root,
    stringArray,
  } = context;

  function collectTaskArtifacts(task) {
    const artifacts = [];
    for (const entry of Array.isArray(task?.verificationLog) ? task.verificationLog : []) {
      for (const artifact of Array.isArray(entry?.artifacts) ? entry.artifacts : []) {
        if (artifact?.path) artifacts.push({ taskId: task.id, check: entry.check, outcome: entry.outcome || entry.status || null, ...artifact });
      }
    }
    return artifacts;
  }

  function readRunCheckArtifactIndex() {
    const indexPath = path.join(getCoordinationPaths().artifactsRoot, 'index.ndjson');
    if (!fs.existsSync(indexPath)) return [];
    return fs.readFileSync(indexPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        const artifactPath = entry.artifactPath || entry.path;
        const items = [];
        const outcome = typeof entry.exitCode === 'number' ? (entry.exitCode === 0 ? 'pass' : 'fail') : null;
        if (artifactPath) {
          const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(root, artifactPath);
          items.push({
            source: 'run-check',
            path: normalizePath(absolutePath) || artifactPath,
            kind: entry.artifactKind ?? null,
            check: entry.name ?? null,
            taskId: entry.taskId ?? null,
            outcome,
            exitCode: entry.exitCode ?? null,
            createdAt: entry.finishedAt || entry.startedAt || null,
          });
        }
        for (const artifact of Array.isArray(entry.visualArtifacts?.artifacts) ? entry.visualArtifacts.artifacts : []) {
          if (!artifact?.path) continue;
          items.push({
            source: 'run-check-artifact',
            path: artifact.path,
            kind: artifact.kind ?? null,
            check: entry.name ?? null,
            taskId: entry.taskId ?? null,
            outcome,
            exitCode: entry.exitCode ?? null,
            createdAt: entry.finishedAt || entry.startedAt || artifact.modifiedAt || null,
            sizeBytes: artifact.sizeBytes ?? null,
          });
        }
        return items;
      } catch {
        return [];
      }
    });
  }

  function buildArtifactItems() {
    const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
    const taskArtifacts = (Array.isArray(board.tasks) ? board.tasks : []).flatMap((task) =>
      collectTaskArtifacts(task).map((artifact) => ({ source: 'verification', ...artifact }))
    );
    return [...taskArtifacts, ...readRunCheckArtifactIndex()];
  }

  function getArtifactPolicy(argv = []) {
    const { config } = loadConfig();
    const configured = config.artifacts && typeof config.artifacts === 'object' && !Array.isArray(config.artifacts) ? config.artifacts : {};
    const keepDays = getNumberFlag(argv, '--keep-days', configured.keepDays ?? defaultArtifactPolicy.keepDays);
    const keepFailedDays = getNumberFlag(argv, '--keep-failed-days', configured.keepFailedDays ?? defaultArtifactPolicy.keepFailedDays);
    const maxMb = getNumberFlag(argv, '--max-mb', configured.maxMb ?? defaultArtifactPolicy.maxMb);
    return {
      roots: stringArray(configured.roots).length ? stringArray(configured.roots) : defaultArtifactPolicy.roots,
      keepDays: Math.max(1, keepDays),
      keepFailedDays: Math.max(1, keepFailedDays),
      maxMb: Math.max(1, maxMb),
      protectPatterns: stringArray(configured.protectPatterns),
    };
  }

  function globPatternMatches(pattern, normalizedPath) {
    const normalizedPattern = normalizePath(pattern);
    if (!normalizedPattern) return false;
    if (!/[?*[\]]/.test(normalizedPattern)) return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
    const globstarToken = '\0GLOBSTAR\0';
    const escaped = normalizedPattern
      .replace(/\*\*/g, globstarToken)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll(globstarToken, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${escaped}$`).test(normalizedPath);
  }

  function listFilesRecursive(rootPath) {
    if (!fs.existsSync(rootPath)) return [];
    const files = [];
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) files.push(...listFilesRecursive(entryPath));
      else if (entry.isFile()) files.push(entryPath);
    }
    return files;
  }

  function buildTaskStatusMap() {
    const board = readJsonSafe(getCoordinationPaths().boardPath, { tasks: [] });
    return new Map((Array.isArray(board.tasks) ? board.tasks : []).map((task) => [task.id, task.status || 'unknown']));
  }

  function buildArtifactReferenceMap(items) {
    const references = new Map();
    for (const item of items) {
      if (!item.path) continue;
      const normalized = normalizePath(item.path);
      const current = references.get(normalized) ?? [];
      current.push(item);
      references.set(normalized, current);
    }
    return references;
  }

  function classifyArtifactFile(filePath, references, taskStatuses, policy, nowMs = Date.now()) {
    const normalizedPath = normalizePath(filePath);
    const stats = fs.statSync(filePath);
    const refs = references.get(normalizedPath) ?? [];
    const protectedByPattern = policy.protectPatterns.some((pattern) => globPatternMatches(pattern, normalizedPath));
    const protectedByActiveTask = refs.some((ref) => ref.taskId && activeStatuses.has(taskStatuses.get(ref.taskId)));
    const ageDays = Math.max(0, (nowMs - stats.mtimeMs) / 86400000);
    const failed = refs.some((ref) => String(ref.outcome || '').toLowerCase() === 'fail');
    const keepDays = failed ? policy.keepFailedDays : policy.keepDays;
    const eligibleByAge = ageDays >= keepDays;
    return {
      path: normalizedPath,
      absolutePath: filePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      ageDays,
      references: refs,
      protected: protectedByPattern || protectedByActiveTask,
      protectedReasons: [protectedByPattern ? 'protected-pattern' : null, protectedByActiveTask ? 'active-task-reference' : null].filter(Boolean),
      eligibleByAge,
      reasons: eligibleByAge ? [`older-than-${keepDays}-days`] : [],
    };
  }

  function buildArtifactPrunePlan(argv = []) {
    const policy = getArtifactPolicy(argv);
    const items = buildArtifactItems();
    const references = buildArtifactReferenceMap(items);
    const taskStatuses = buildTaskStatusMap();
    const roots = policy.roots.map((rootPath) => {
      const absolutePath = resolveRepoPath(rootPath, rootPath);
      const normalizedPath = normalizePath(absolutePath);
      return { root: rootPath, absolutePath, normalizedPath, exists: fs.existsSync(absolutePath), skipped: normalizedPath.startsWith('..') };
    });
    const files = roots
      .filter((rootPath) => rootPath.exists && !rootPath.skipped)
      .flatMap((rootPath) => listFilesRecursive(rootPath.absolutePath))
      .map((filePath) => classifyArtifactFile(filePath, references, taskStatuses, policy));
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const maxBytes = policy.maxMb * 1024 * 1024;
    const candidates = new Map();
    for (const file of files) {
      if (!file.protected && file.eligibleByAge) candidates.set(file.path, { ...file });
    }
    let projectedBytes = totalBytes - [...candidates.values()].reduce((sum, file) => sum + file.sizeBytes, 0);
    if (projectedBytes > maxBytes) {
      const overflowCandidates = files
        .filter((file) => !file.protected && !candidates.has(file.path))
        .sort((left, right) => new Date(left.modifiedAt).getTime() - new Date(right.modifiedAt).getTime());
      for (const file of overflowCandidates) {
        if (projectedBytes <= maxBytes) break;
        candidates.set(file.path, { ...file, reasons: [...file.reasons, 'storage-limit'] });
        projectedBytes -= file.sizeBytes;
      }
    }
    return { policy, roots, totalBytes, maxBytes, files: files.length, candidates: [...candidates.values()] };
  }

  function runArtifactsPrune(argv) {
    const json = hasFlag(argv, '--json');
    const apply = hasFlag(argv, '--apply');
    const plan = buildArtifactPrunePlan(argv);
    const removed = [];
    if (apply) {
      withStateTransactionSync(plan.candidates.map((candidate) => candidate.absolutePath), () => {
        for (const candidate of plan.candidates) {
          fs.rmSync(candidate.absolutePath, { force: true });
          removed.push({ path: candidate.path, sizeBytes: candidate.sizeBytes, reasons: candidate.reasons });
        }
      });
    }
    const result = { ok: true, applied: apply, ...plan, removed };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(apply ? 'Artifact prune applied.' : 'Artifact prune dry run.');
      console.log(`Total: ${plan.totalBytes} bytes; limit: ${plan.maxBytes} bytes`);
      console.log(plan.candidates.length ? plan.candidates.map((candidate) => `- ${candidate.path} (${candidate.sizeBytes} bytes; ${candidate.reasons.join(', ')})`).join('\n') : '- nothing to prune');
    }
    return 0;
  }

  function runArtifactsCommand(argv) {
    const json = hasFlag(argv, '--json');
    const positionals = getPositionals(argv, new Set(['--task', '--check', '--keep-days', '--keep-failed-days', '--max-mb']));
    const subcommand = positionals[0] || 'list';
    const items = buildArtifactItems();

    if (subcommand === 'prune') return runArtifactsPrune(argv);

    if (subcommand === 'list') {
      const taskFilter = getFlagValue(argv, '--task', '');
      const checkFilter = getFlagValue(argv, '--check', '');
      const filtered = items.filter((item) => (!taskFilter || item.taskId === taskFilter) && (!checkFilter || item.check === checkFilter));
      if (json) console.log(JSON.stringify({ items: filtered }, null, 2));
      else console.log(filtered.length ? filtered.map((item) => `- ${item.path}${item.taskId ? ` (${item.taskId}` : ''}${item.check ? `${item.taskId ? ', ' : ' ('}${item.check}` : ''}${item.taskId || item.check ? ')' : ''}`).join('\n') : 'No artifacts found.');
      return 0;
    }

    if (subcommand === 'inspect') {
      const artifactPath = positionals[1];
      if (!artifactPath) {
        return printCommandError('Usage: artifacts inspect <artifact-path> [--json]', { json });
      }
      const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(root, artifactPath);
      if (!fs.existsSync(absolutePath)) {
        return printCommandError(`Artifact does not exist: ${artifactPath}`, { json, code: 'not_found' });
      }
      const normalizedPath = normalizePath(absolutePath) || artifactPath;
      const stats = fs.statSync(absolutePath);
      const result = {
        ok: true,
        path: normalizedPath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        references: items.filter((item) => item.path === normalizedPath),
      };
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`Artifact: ${result.path}`);
        console.log(`Size: ${result.sizeBytes} bytes`);
        console.log(`Modified: ${result.modifiedAt}`);
        console.log(result.references.length ? `References: ${result.references.length}` : 'References: none');
      }
      return 0;
    }

    return printCommandError('Usage: artifacts list [--task <task-id>] [--check <check>] [--json] | artifacts inspect <artifact-path> [--json] | artifacts prune [--apply] [--json]', { json });
  }

  return {
    buildArtifactItems,
    collectTaskArtifacts,
    runArtifactsCommand,
  };
}
