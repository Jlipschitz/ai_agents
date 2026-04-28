#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CHECK_ROOTS = ['bin', 'scripts', 'tests'];

function normalizePath(filePath) {
  return path.relative(ROOT, filePath).replaceAll('\\', '/');
}

function collectMjsFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMjsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = CHECK_ROOTS.flatMap((entry) => collectMjsFiles(path.join(ROOT, entry)));

if (!files.length) {
  console.error('No .mjs files found to syntax-check.');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0 && !result.error) {
    continue;
  }

  failures += 1;
  console.error(`Syntax check failed: ${normalizePath(file)}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
}

if (failures) {
  console.error(`Syntax check failed for ${failures} of ${files.length} file(s).`);
  process.exit(1);
}

console.log(`Syntax OK: ${files.length} .mjs file(s).`);
