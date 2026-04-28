import fs from 'node:fs';
import path from 'node:path';

import { normalizePath } from './path-utils.mjs';

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => normalizePath(entry.trim()))
    : [];
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  if (normalizedScope === '.') return true;
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function rootExists(root, workspaceRoot) {
  return fs.existsSync(path.join(root, workspaceRoot === '.' ? '' : workspaceRoot));
}

function packageNameFor(root, workspaceRoot) {
  const packagePath = path.join(root, workspaceRoot === '.' ? '' : workspaceRoot, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return typeof packageJson.name === 'string' && packageJson.name.trim() ? packageJson.name.trim() : null;
  } catch {
    return null;
  }
}

function descriptorFor(root, settings, pattern, workspaceRoot) {
  const normalizedRoot = normalizePath(workspaceRoot) || '.';
  const exists = rootExists(root, normalizedRoot);
  return {
    root: normalizedRoot,
    pattern,
    exists,
    partial: !exists && settings.partialCheckout,
    packageName: packageNameFor(root, normalizedRoot),
  };
}

function wildcardRootForPath(pattern, relativePath) {
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern.endsWith('/*')) return null;
  const prefix = normalizedPattern.slice(0, -2);
  const normalizedPath = normalizePath(relativePath);
  if (!pathMatchesScope(normalizedPath, prefix)) return null;
  const prefixSegments = prefix === '.' ? [] : prefix.split('/').filter(Boolean);
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  if (pathSegments.length <= prefixSegments.length) return null;
  return [...prefixSegments, pathSegments[prefixSegments.length]].join('/') || '.';
}

function workspaceRootForPath(pattern, relativePath) {
  const normalizedPattern = normalizePath(pattern) || '.';
  if (normalizedPattern.includes('*')) return wildcardRootForPath(normalizedPattern, relativePath);
  return pathMatchesScope(relativePath, normalizedPattern) ? normalizedPattern : null;
}

function wildcardPrefix(pattern) {
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern.endsWith('/*')) return null;
  return normalizedPattern.slice(0, -2) || '.';
}

export function getMonorepoConfig(config = {}) {
  const monorepo = config.monorepo && typeof config.monorepo === 'object' && !Array.isArray(config.monorepo)
    ? config.monorepo
    : {};
  return {
    partialCheckout: monorepo.partialCheckout === true,
    workspaceRoots: stringArray(monorepo.workspaceRoots),
    fallbackRoot: typeof monorepo.fallbackRoot === 'string' && monorepo.fallbackRoot.trim()
      ? normalizePath(monorepo.fallbackRoot.trim()) || '.'
      : '.',
  };
}

export function workspaceForPath(root, config, relativePath) {
  const settings = getMonorepoConfig(config);
  const matches = [];
  for (const pattern of settings.workspaceRoots) {
    const workspaceRoot = workspaceRootForPath(pattern, relativePath);
    if (workspaceRoot) matches.push(descriptorFor(root, settings, pattern, workspaceRoot));
  }
  return matches.sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

export function listConfiguredWorkspaces(root, config) {
  const settings = getMonorepoConfig(config);
  const workspaces = [];
  const missingPatterns = [];

  for (const pattern of settings.workspaceRoots) {
    const wildcard = wildcardPrefix(pattern);
    if (!wildcard) {
      const descriptor = descriptorFor(root, settings, pattern, pattern);
      workspaces.push(descriptor);
      if (!descriptor.exists) missingPatterns.push(pattern);
      continue;
    }

    const prefixPath = path.join(root, wildcard === '.' ? '' : wildcard);
    if (!fs.existsSync(prefixPath)) {
      missingPatterns.push(pattern);
      continue;
    }

    const entries = fs.readdirSync(prefixPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (!entries.length) missingPatterns.push(pattern);
    for (const entry of entries) {
      workspaces.push(descriptorFor(root, settings, pattern, normalizePath(path.join(wildcard, entry.name))));
    }
  }

  return {
    configured: settings.workspaceRoots.length > 0,
    partialCheckout: settings.partialCheckout,
    fallbackRoot: settings.fallbackRoot,
    patterns: settings.workspaceRoots,
    workspaces: workspaces.sort((left, right) => left.root.localeCompare(right.root)),
    missingPatterns: [...new Set(missingPatterns)].sort((left, right) => left.localeCompare(right)),
  };
}

export function buildWorkspaceImpact(root, config, paths) {
  const settings = getMonorepoConfig(config);
  const impactsByRoot = new Map();

  for (const relativePath of paths) {
    const workspace = workspaceForPath(root, config, relativePath);
    if (!workspace) continue;
    const existing = impactsByRoot.get(workspace.root) ?? { ...workspace, matchedPaths: [] };
    existing.matchedPaths.push(normalizePath(relativePath));
    impactsByRoot.set(workspace.root, existing);
  }

  return {
    configured: settings.workspaceRoots.length > 0,
    partialCheckout: settings.partialCheckout,
    impacted: [...impactsByRoot.values()]
      .map((entry) => ({ ...entry, matchedPaths: [...new Set(entry.matchedPaths)].sort((left, right) => left.localeCompare(right)) }))
      .sort((left, right) => left.root.localeCompare(right.root)),
  };
}
