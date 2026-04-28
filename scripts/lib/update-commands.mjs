import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { buildInstallManifest } from './install-manifest.mjs';
import { normalizePath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';

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

function splitLines(buffer) {
  if (buffer === null) return [];
  const text = buffer.toString('utf8');
  if (!text) return [];
  return text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n');
}

function lineDiffStats(source, target) {
  const sourceLines = splitLines(source);
  const targetLines = splitLines(target);
  let prefix = 0;
  while (prefix < sourceLines.length && prefix < targetLines.length && sourceLines[prefix] === targetLines[prefix]) {
    prefix += 1;
  }

  let sourceSuffix = sourceLines.length - 1;
  let targetSuffix = targetLines.length - 1;
  while (sourceSuffix >= prefix && targetSuffix >= prefix && sourceLines[sourceSuffix] === targetLines[targetSuffix]) {
    sourceSuffix -= 1;
    targetSuffix -= 1;
  }

  return {
    additions: Math.max(0, sourceSuffix - prefix + 1),
    deletions: Math.max(0, targetSuffix - prefix + 1),
  };
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
    return { path: relativePath, status: 'create', sourcePath, targetPath, review: { sourceBytes: source.length, targetBytes: 0, ...lineDiffStats(source, null) } };
  }

  const status = Buffer.compare(source, target) === 0 ? 'unchanged' : 'update';
  return {
    path: relativePath,
    status,
    sourcePath,
    targetPath,
    ...(status === 'update' ? { review: { sourceBytes: source.length, targetBytes: target.length, ...lineDiffStats(source, target) } } : {}),
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
  const reviewAcknowledged = hasFlag(argv, '--reviewed');
  const files = buildInstallManifest(sourceRoot, { includeDocs, includeConfig: false })
    .map((relativePath) => compareFile(sourceRoot, targetRoot, relativePath));
  const warnings = [];
  const changed = files.filter((file) => file.status === 'create' || file.status === 'update');

  if (sourceRoot === targetRoot) {
    warnings.push('Source and target roots are the same; no external update source was provided.');
  }
  if (!includeDocs) {
    warnings.push('Local docs are preserved by default. Pass --include-docs to update bundled documentation files.');
  }
  if (changed.length > 0 && !reviewAcknowledged) {
    warnings.push('Review the dry-run file summary, then pass --reviewed with --apply to copy changed files.');
  }

  return {
    ok: files.every((file) => file.status !== 'missing-source'),
    applied: false,
    sourceRoot,
    targetRoot,
    includeDocs,
    reviewAcknowledged,
    counts: countByStatus(files),
    review: {
      changedFiles: changed.length,
      additions: changed.reduce((total, file) => total + (file.review?.additions ?? 0), 0),
      deletions: changed.reduce((total, file) => total + (file.review?.deletions ?? 0), 0),
    },
    files,
    warnings,
  };
}

export function runUpdateCoordinator(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const plan = buildUpdateCoordinatorPlan(argv, context);
  const changed = plan.files.filter((file) => file.status === 'create' || file.status === 'update');
  const reviewRequired = apply && changed.length > 0 && !plan.reviewAcknowledged;

  if (reviewRequired) {
    plan.warnings.push('Apply blocked: rerun with --reviewed after reviewing the dry-run summary.');
  } else if (apply && plan.ok) {
    withStateTransactionSync(changed.map((change) => change.targetPath), () => {
      for (const change of changed) {
        applyFileChange(change);
      }
    });
    plan.applied = true;
  }

  const result = {
    ok: plan.ok && !reviewRequired,
    applied: plan.applied,
    sourceRoot: plan.sourceRoot,
    targetRoot: plan.targetRoot,
    includeDocs: plan.includeDocs,
    reviewAcknowledged: plan.reviewAcknowledged,
    reviewRequired,
    counts: plan.counts,
    review: plan.review,
    files: plan.files.map((file) => ({ path: file.path, status: file.status, review: file.review })),
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
    console.log(`Review: ${plan.review.changedFiles} changed file(s), +${plan.review.additions}/-${plan.review.deletions} changed line section(s)`);
    for (const warning of plan.warnings) console.warn(`warning: ${warning}`);
    for (const file of changed.slice(0, 20)) console.log(`- ${file.status}: ${file.path} (+${file.review?.additions ?? 0}/-${file.review?.deletions ?? 0})`);
    if (changed.length > 20) console.log(`- ${changed.length - 20} more file(s)`);
  }

  return result.ok ? 0 : 1;
}
