import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { execGit } from './git-utils.mjs';
import { buildWorkspaceImpact } from './monorepo-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const DEFAULT_CODEOWNERS_FILES = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
const DEFAULT_BROAD_PATHS = ['app', 'src', 'components', 'features', 'lib', 'api', 'server', 'packages'];

function stringArray(value, fallback = []) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : fallback;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function codeownersPatternMatches(filePath, pattern) {
  let normalizedPattern = pattern.trim();
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPattern || normalizedPattern.startsWith('!')) return false;
  normalizedPattern = normalizedPattern.replace(/^\/+/, '');
  if (normalizedPattern.endsWith('/')) return pathMatchesScope(normalizedPath, normalizedPattern.slice(0, -1));
  if (!normalizedPattern.includes('/')) return normalizedPath.split('/').includes(normalizedPattern) || globToRegExp(normalizedPattern).test(path.basename(normalizedPath));
  return globToRegExp(normalizedPattern).test(normalizedPath) || pathMatchesScope(normalizedPath, normalizedPattern);
}

function parseCodeowners(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([pattern, ...owners]) => ({ pattern, owners }));
}

export function findCodeowners(root, config) {
  const files = stringArray(config.ownership?.codeownersFiles, DEFAULT_CODEOWNERS_FILES);
  for (const relativePath of files) {
    const filePath = path.resolve(root, relativePath);
    if (fs.existsSync(filePath)) {
      return { path: relativePath, rules: parseCodeowners(fs.readFileSync(filePath, 'utf8')) };
    }
  }
  return { path: null, rules: [] };
}

export function ownersForPath(filePath, rules) {
  let owners = [];
  for (const rule of rules) {
    if (codeownersPatternMatches(filePath, rule.pattern)) owners = rule.owners;
  }
  return owners;
}

function parsePathsArg(argv) {
  return getFlagValue(argv, '--paths', '')
    .split(',')
    .map((entry) => normalizePath(entry))
    .filter(Boolean);
}

function gitChangedPaths(root) {
  const output = execGit(['status', '--porcelain=v1'], { root });
  if (output === null) return { available: false, paths: [] };
  const paths = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((entry) => (entry.includes(' -> ') ? entry.slice(entry.lastIndexOf(' -> ') + 4) : entry))
    .map((entry) => normalizePath(entry))
    .filter(Boolean);
  return { available: true, paths: [...new Set(paths)] };
}

export function buildOwnershipReview({ root, config, board, activeStatuses }) {
  const codeowners = findCodeowners(root, config);
  const broadPaths = stringArray(config.ownership?.broadPathPatterns, DEFAULT_BROAD_PATHS);
  const reviews = [];
  const findings = [];
  const findingDetails = [];

  for (const task of board.tasks ?? []) {
    if (!activeStatuses.has(task.status)) continue;
    const claimedPaths = stringArray(task.claimedPaths);
    const broadClaims = claimedPaths.filter((claimedPath) => broadPaths.some((broadPath) => normalizePath(claimedPath) === normalizePath(broadPath)));
    const ownerGroups = claimedPaths.map((claimedPath) => ({ path: claimedPath, owners: ownersForPath(claimedPath, codeowners.rules) }));
    const ownerKeys = new Set(ownerGroups.filter((entry) => entry.owners.length).map((entry) => entry.owners.join(' ')));

    if (broadClaims.length) {
      const message = `Task ${task.id} claims broad path(s): ${broadClaims.join(', ')}.`;
      findings.push(message);
      findingDetails.push({ type: 'broad-claim', taskId: task.id, paths: broadClaims, message });
    }
    if (ownerKeys.size > 1) {
      const message = `Task ${task.id} crosses CODEOWNERS boundaries: ${ownerGroups.map((entry) => `${entry.path} -> ${entry.owners.join(' ') || 'unowned'}`).join('; ')}.`;
      findings.push(message);
      findingDetails.push({ type: 'codeowners-crossing', taskId: task.id, owners: ownerGroups, message });
    }

    reviews.push({ taskId: task.id, ownerId: task.ownerId ?? null, claimedPaths, broadClaims, owners: ownerGroups });
  }

  return { ok: findings.length === 0, codeownersPath: codeowners.path, findings, findingDetails, reviews };
}

function checkMatchesPaths(check, paths) {
  const scopes = stringArray(check.requiredForPaths);
  if (!scopes.length) return [];
  return paths.filter((filePath) => scopes.some((scope) => pathMatchesScope(filePath, scope)));
}

function visualMatches(config, paths) {
  const visualPaths = stringArray(config.paths?.visualImpact);
  const visualFiles = stringArray(config.paths?.visualImpactFiles);
  return paths.filter((filePath) => visualFiles.includes(filePath) || visualPaths.some((scope) => pathMatchesScope(filePath, scope)));
}

export function buildTestImpact({ root, config, packageJson, argv }) {
  const explicitPaths = parsePathsArg(argv);
  const git = explicitPaths.length ? { available: true, paths: explicitPaths } : gitChangedPaths(root);
  const checks = [];
  const configuredChecks = config.checks && typeof config.checks === 'object' ? config.checks : {};
  const workspaceImpact = buildWorkspaceImpact(root, config, git.paths);

  for (const [name, check] of Object.entries(configuredChecks)) {
    const matchedPaths = checkMatchesPaths(check, git.paths);
    if (matchedPaths.length) checks.push({ name, command: check.command ?? `npm run ${name}`, reason: 'requiredForPaths', matchedPaths });
  }

  const visualMatchedPaths = visualMatches(config, git.paths);
  for (const name of stringArray(config.verification?.visualRequiredChecks)) {
    if (!checks.some((check) => check.name === name) && visualMatchedPaths.length) {
      const command = configuredChecks[name]?.command ?? packageJson?.scripts?.[name] ?? `npm run ${name}`;
      checks.push({ name, command, reason: 'visualImpact', matchedPaths: visualMatchedPaths });
    }
  }

  if (!checks.length && packageJson?.scripts?.test && git.paths.length) {
    checks.push({ name: 'test', command: 'npm test', reason: 'fallback', matchedPaths: git.paths });
  }

  const result = { ok: true, gitAvailable: git.available, paths: git.paths, checks, warnings: git.paths.length ? [] : ['No changed paths were provided or detected.'] };
  if (workspaceImpact.configured) result.workspaces = workspaceImpact;
  return result;
}

export function runOwnershipReview(argv, context) {
  const result = buildOwnershipReview(context);
  if (hasFlag(argv, '--json')) {
    const { findingDetails, ...publicResult } = result;
    console.log(JSON.stringify(publicResult, null, 2));
  }
  else {
    console.log('# Ownership Review');
    console.log(`CODEOWNERS: ${result.codeownersPath ?? 'not found'}`);
    console.log(result.findings.length ? result.findings.map((entry) => `- ${entry}`).join('\n') : '- no ownership findings');
  }
  return result.ok ? 0 : 1;
}

export function runTestImpact(argv, context) {
  const result = buildTestImpact({ ...context, argv });
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('# Test Impact');
    console.log(`Paths: ${result.paths.length ? result.paths.join(', ') : 'none'}`);
    if (result.workspaces?.impacted?.length) console.log(`Workspaces: ${result.workspaces.impacted.map((entry) => entry.root).join(', ')}`);
    console.log(result.checks.length ? result.checks.map((check) => `- ${check.name}: ${check.command}`).join('\n') : '- no checks selected');
    if (result.warnings.length) console.log(result.warnings.map((entry) => `- warning: ${entry}`).join('\n'));
  }
  return 0;
}
