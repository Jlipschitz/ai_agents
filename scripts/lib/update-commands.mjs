import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { buildInstallManifest } from './install-manifest.mjs';
import { normalizePath } from './path-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

function resolveSourceRoot(argv) {
  const source = getFlagValue(argv, '--source', process.env.AI_AGENTS_UPDATE_SOURCE || PACKAGE_ROOT);
  return path.resolve(source);
}

function readFileOrNull(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function compareFile(sourceRoot, targetRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(targetRoot, relativePath);
  const source = readFileOrNull(sourcePath);

  if (source === null) {
    return { path: relativePath, status: 'missing-source', sourcePath, targetPath };
  }

  const target = readFileOrNull(targetPath);
  if (target === null) {
    return { path: relativePath, status: 'create', sourcePath, targetPath };
  }

  return {
    path: relativePath,
    status: Buffer.compare(source, target) === 0 ? 'unchanged' : 'update',
    sourcePath,
    targetPath,
  };
}

function applyFileChange(change) {
  fs.mkdirSync(path.dirname(change.targetPath), { recursive: true });
  fs.copyFileSync(change.sourcePath, change.targetPath);
}

function countByStatus(files) {
  return files.reduce((counts, file) => {
    counts[file.status] = (counts[file.status] || 0) + 1;
    return counts;
  }, {});
}

export function buildUpdateCoordinatorPlan(argv, context) {
  const sourceRoot = resolveSourceRoot(argv);
  const targetRoot = context.root;
  const includeDocs = hasFlag(argv, '--include-docs');
  const files = buildInstallManifest(sourceRoot, { includeDocs, includeConfig: false })
    .map((relativePath) => compareFile(sourceRoot, targetRoot, relativePath));
  const warnings = [];

  if (sourceRoot === targetRoot) {
    warnings.push('Source and target roots are the same; no external update source was provided.');
  }
  if (!includeDocs) {
    warnings.push('Local docs are preserved by default. Pass --include-docs to update bundled documentation files.');
  }

  return {
    ok: files.every((file) => file.status !== 'missing-source'),
    applied: false,
    sourceRoot,
    targetRoot,
    includeDocs,
    counts: countByStatus(files),
    files,
    warnings,
  };
}

export function runUpdateCoordinator(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildUpdateCoordinatorPlan(argv, context);
  const changed = plan.files.filter((file) => file.status === 'create' || file.status === 'update');

  if (apply && plan.ok) {
    for (const change of changed) {
      applyFileChange(change);
    }
    plan.applied = true;
  }

  const result = {
    ok: plan.ok,
    applied: plan.applied,
    sourceRoot: plan.sourceRoot,
    targetRoot: plan.targetRoot,
    includeDocs: plan.includeDocs,
    counts: plan.counts,
    files: plan.files.map((file) => ({ path: file.path, status: file.status })),
    warnings: plan.warnings,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const action = apply ? (plan.applied ? 'applied' : 'not applied') : 'dry run';
    console.log(`Coordinator update ${action}.`);
    console.log(`Source: ${normalizePath(plan.sourceRoot) || plan.sourceRoot}`);
    console.log(`Target: ${normalizePath(plan.targetRoot) || plan.targetRoot}`);
    console.log(`Create: ${plan.counts.create || 0}; update: ${plan.counts.update || 0}; unchanged: ${plan.counts.unchanged || 0}; missing source: ${plan.counts['missing-source'] || 0}`);
    for (const warning of plan.warnings) console.warn(`warning: ${warning}`);
    for (const file of changed.slice(0, 20)) console.log(`- ${file.status}: ${file.path}`);
    if (changed.length > 20) console.log(`- ${changed.length - 20} more file(s)`);
  }

  return plan.ok ? 0 : 1;
}
