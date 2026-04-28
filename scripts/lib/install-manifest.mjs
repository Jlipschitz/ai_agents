import fs from 'node:fs';
import path from 'node:path';

export const COORDINATOR_FILES = [
  'bin/ai-agents.mjs',
  'scripts/agent-command-layer.mjs',
  'scripts/agent-coordination-core.mjs',
  'scripts/agent-coordination.mjs',
  'scripts/agent-coordination-two.mjs',
  'scripts/agent-watch-loop.mjs',
  'scripts/agent-watch-loop.ps1',
  'scripts/agent-watch-loop-two.ps1',
  'scripts/bootstrap.mjs',
  'scripts/check-syntax.mjs',
  'scripts/explain-config.mjs',
  'scripts/jsdoc-check.mjs',
  'scripts/lint.mjs',
  'scripts/lock-runtime.mjs',
  'scripts/planner-sizing.mjs',
  'scripts/validate-config.mjs',
  'agent-coordination.schema.json',
];

export const CONFIG_FILES = [
  'agent-coordination.config.json',
];

export const DOCUMENTATION_FILES = [
  'docs/agent-coordination-portability.md',
  'docs/commands.md',
  'docs/workflows.md',
  'docs/architecture.md',
  'docs/state-files.md',
  'docs/troubleshooting.md',
  'docs/explain-config.md',
  'docs/terminal-output-examples.md',
  'docs/implementation-status.md',
  'docs/roadmap-status.md',
];

export const COORDINATOR_DIRECTORIES = [
  'scripts/lib',
];

export function listFilesRecursive(root, relativeDir) {
  const sourceDir = path.join(root, relativeDir);
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = path.join(relativeDir, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        return listFilesRecursive(root, relativePath);
      }
      return entry.isFile() ? [relativePath] : [];
    });
}

export function buildInstallManifest(root, options = {}) {
  const files = [
    ...COORDINATOR_FILES,
    ...(options.includeConfig ? CONFIG_FILES : []),
    ...(options.includeDocs ? DOCUMENTATION_FILES : []),
    ...COORDINATOR_DIRECTORIES.flatMap((relativeDir) => listFilesRecursive(root, relativeDir)),
  ];
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}
