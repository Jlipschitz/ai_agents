import path from 'node:path';

export function normalizePath(inputPath, root = process.cwd()) {
  if (!inputPath) return '';
  let normalized = String(inputPath).trim().replaceAll('\\', '/');
  if (path.isAbsolute(normalized)) normalized = path.relative(root, normalized).replaceAll('\\', '/');
  return normalized.replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function resolveRepoPath(value, fallbackRelativePath, root = process.cwd()) {
  const normalized = String(value ?? '').trim() || fallbackRelativePath;
  return path.isAbsolute(normalized) ? normalized : path.resolve(root, normalized);
}

export function resolveCoordinationRoot(env = process.env, root = process.cwd(), defaultDir = 'coordination') {
  const rootOverride = String(env.AGENT_COORDINATION_ROOT ?? '').trim();
  if (rootOverride) return path.isAbsolute(rootOverride) ? rootOverride : path.resolve(root, rootOverride);
  const dirOverride = String(env.AGENT_COORDINATION_DIR ?? '').trim();
  return path.join(root, dirOverride || defaultDir);
}

export function resolveConfigPath(env = process.env, root = process.cwd()) {
  return resolveRepoPath(env.AGENT_COORDINATION_CONFIG, 'agent-coordination.config.json', root);
}
