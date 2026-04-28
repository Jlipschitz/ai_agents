import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { hasFlag } from './args-utils.mjs';
import { fileTimestamp, nowIso } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

function relativePath(root, filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function listFilesRecursive(root, dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const filePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'snapshots' && path.dirname(filePath) === root) return [];
        return listFilesRecursive(root, filePath);
      }
      return entry.isFile() ? [filePath] : [];
    });
}

function readSnapshotFile(root, filePath, label) {
  const exists = fs.existsSync(filePath);
  const entry = {
    label,
    path: relativePath(root, filePath),
    exists,
    sizeBytes: exists ? fs.statSync(filePath).size : 0,
  };
  if (exists) {
    entry.content = fs.readFileSync(filePath, 'utf8');
  }
  return entry;
}

function collectSnapshotFiles(paths) {
  const primaryFiles = [
    [paths.boardPath, 'board'],
    [paths.journalPath, 'journal'],
    [paths.messagesPath, 'messages'],
  ].map(([filePath, label]) => readSnapshotFile(paths.coordinationRoot, filePath, label));

  const runtimeFiles = listFilesRecursive(paths.runtimeRoot, paths.runtimeRoot)
    .map((filePath) => readSnapshotFile(paths.coordinationRoot, filePath, 'runtime'));

  return [...primaryFiles, ...runtimeFiles];
}

export function buildWorkspaceSnapshot(paths) {
  const snapshotPath = path.join(paths.snapshotsRoot, `workspace-${fileTimestamp()}.json.gz`);
  const files = collectSnapshotFiles(paths);
  return {
    version: 1,
    createdAt: nowIso(),
    coordinationRoot: paths.coordinationRoot,
    snapshotPath,
    files,
  };
}

export function writeWorkspaceSnapshot(snapshot) {
  fs.mkdirSync(path.dirname(snapshot.snapshotPath), { recursive: true });
  const payload = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(snapshot.snapshotPath, zlib.gzipSync(payload));
}

export function runSnapshotWorkspace(argv, paths) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const snapshot = buildWorkspaceSnapshot(paths);

  if (apply) {
    writeWorkspaceSnapshot(snapshot);
  }

  const result = {
    ok: true,
    applied: apply,
    snapshotPath: snapshot.snapshotPath,
    files: snapshot.files.map((file) => ({
      label: file.label,
      path: file.path,
      exists: file.exists,
      sizeBytes: file.sizeBytes,
    })),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(apply ? 'Workspace snapshot written.' : 'Workspace snapshot dry run.');
    console.log(`Snapshot: ${normalizePath(snapshot.snapshotPath) || snapshot.snapshotPath}`);
    console.log(result.files.map((file) => `- ${file.exists ? 'include' : 'missing'} ${file.path}`).join('\n'));
  }

  return 0;
}
