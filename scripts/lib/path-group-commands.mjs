import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const RESOLVE_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'];
const PRODUCT_PREFIXES = new Set(['app', 'src', 'components', 'features', 'packages']);
const DATA_PREFIXES = new Set(['api', 'server', 'lib', 'db', 'database', 'migrations']);
const VERIFY_PREFIXES = new Set(['tests', 'test', '__tests__', 'spec']);
const DOCS_PREFIXES = new Set(['docs']);

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function pathExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function isSourcePath(relativePath) {
  return SOURCE_EXTENSIONS.includes(path.extname(relativePath));
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findPackageRoot(root, relativePath) {
  let current = path.dirname(path.join(root, relativePath));
  while (isWithinRoot(root, current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return normalizePath(path.relative(root, current)) || '.';
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '.';
}

function categoryForSegments(segments) {
  const prefix = segments[0] ?? '';
  if (VERIFY_PREFIXES.has(prefix)) return 'verify';
  if (DOCS_PREFIXES.has(prefix)) return 'docs';
  if (DATA_PREFIXES.has(prefix)) return 'data';
  if (PRODUCT_PREFIXES.has(prefix)) return 'product';
  return 'other';
}

function groupForPath(root, relativePath) {
  const normalized = normalizePath(relativePath);
  const packageRoot = findPackageRoot(root, normalized);
  const packageRelative = packageRoot && packageRoot !== '.'
    ? normalizePath(path.relative(path.join(root, packageRoot), path.join(root, normalized)))
    : normalized;
  const segments = packageRelative.split('/').filter(Boolean);
  const category = categoryForSegments(segments);
  const moduleName = segments[0] === 'src' || segments[0] === 'app' || segments[0] === 'features'
    ? segments.slice(0, 2).join('/') || segments[0]
    : segments[0] || 'root';
  const id = packageRoot && packageRoot !== '.'
    ? `${packageRoot}:${moduleName}`
    : moduleName;
  const label = packageRoot && packageRoot !== '.'
    ? `${packageRoot} / ${moduleName}`
    : moduleName;
  return { id, label, category, packageRoot };
}

function extractImports(content) {
  const imports = [];
  const importPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const requirePattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(importPattern)) imports.push(match[1]);
  for (const match of content.matchAll(requirePattern)) imports.push(match[1]);
  return imports;
}

function resolveImport(root, fromPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const fromDir = path.dirname(path.join(root, fromPath));
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate) && isWithinRoot(root, candidate));
  return match ? normalizePath(path.relative(root, match)) : null;
}

function collectInputPaths(argv, board) {
  const explicit = splitList(getFlagValue(argv, '--paths', ''));
  if (explicit.length) return unique(explicit);
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  return unique(tasks.flatMap((task) => Array.isArray(task.claimedPaths) ? task.claimedPaths.map((entry) => normalizePath(entry)) : []));
}

export function buildPathGroups({ root, board }, argv = []) {
  const inputPaths = collectInputPaths(argv, board);
  const groupsById = new Map();
  const pathToGroupId = new Map();
  const importEdges = [];

  for (const relativePath of inputPaths) {
    const groupInfo = groupForPath(root, relativePath);
    const group = groupsById.get(groupInfo.id) ?? {
      ...groupInfo,
      paths: [],
      dependencies: [],
      dependents: [],
    };
    group.paths.push(relativePath);
    groupsById.set(group.id, group);
    pathToGroupId.set(relativePath, group.id);
  }

  for (const relativePath of inputPaths.filter((entry) => isSourcePath(entry) && pathExists(root, entry))) {
    const sourceGroupId = pathToGroupId.get(relativePath);
    const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
    for (const specifier of extractImports(content)) {
      const targetPath = resolveImport(root, relativePath, specifier);
      if (!targetPath) continue;
      const targetGroupId = pathToGroupId.get(targetPath);
      if (!targetGroupId || targetGroupId === sourceGroupId) continue;
      importEdges.push({ fromPath: relativePath, toPath: targetPath, fromGroup: sourceGroupId, toGroup: targetGroupId, specifier });
    }
  }

  for (const edge of importEdges) {
    const source = groupsById.get(edge.fromGroup);
    const target = groupsById.get(edge.toGroup);
    if (!source || !target) continue;
    source.dependencies = unique([...source.dependencies, edge.toGroup]);
    target.dependents = unique([...target.dependents, edge.fromGroup]);
  }

  const groups = [...groupsById.values()]
    .map((group) => ({ ...group, paths: unique(group.paths), dependencies: unique(group.dependencies), dependents: unique(group.dependents) }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    inputPaths,
    groups,
    importEdges,
    summary: {
      paths: inputPaths.length,
      groups: groups.length,
      packageGroups: groups.filter((group) => group.packageRoot !== '.').length,
      importEdges: importEdges.length,
    },
  };
}

function renderPathGroups(report) {
  const lines = ['# Path Groups'];
  lines.push(`Paths: ${report.summary.paths}; groups: ${report.summary.groups}; import edges: ${report.summary.importEdges}`);
  if (!report.groups.length) {
    lines.push('- none');
    return lines.join('\n');
  }
  for (const group of report.groups) {
    lines.push('');
    lines.push(`${group.id} (${group.category})`);
    lines.push(`Package: ${group.packageRoot}`);
    lines.push(`Paths: ${group.paths.join(', ')}`);
    if (group.dependencies.length) lines.push(`Depends on: ${group.dependencies.join(', ')}`);
    if (group.dependents.length) lines.push(`Used by: ${group.dependents.join(', ')}`);
  }
  return lines.join('\n');
}

export function runPathGroups(argv, context) {
  const report = buildPathGroups(context, argv);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(renderPathGroups(report));
  return 0;
}
