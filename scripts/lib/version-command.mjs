import fs from 'node:fs';
import path from 'node:path';

import { CURRENT_BOARD_VERSION } from './board-migration.mjs';
import { hasFlag } from './args-utils.mjs';
import { readJsonSafe } from './file-utils.mjs';
import { normalizePath, resolveConfigPath, resolveCoordinationRoot } from './path-utils.mjs';

function packageJsonPathFor(packageRoot) {
  return path.join(packageRoot, 'package.json');
}

export function buildVersionInfo(options = {}) {
  const root = options.root || process.cwd();
  const packageRoot = options.packageRoot || root;
  const packageJsonPath = options.packageJsonPath || packageJsonPathFor(packageRoot);
  const packageJson = readJsonSafe(packageJsonPath, {});
  const configPath = resolveConfigPath(process.env, root);
  const config = readJsonSafe(configPath, {});
  const coordinationRoot = resolveCoordinationRoot(process.env, root);
  const boardPath = path.join(coordinationRoot, 'board.json');
  const board = readJsonSafe(boardPath, null);
  return {
    package: {
      name: packageJson.name || path.basename(packageRoot),
      version: packageJson.version || '0.0.0',
      private: Boolean(packageJson.private),
      path: normalizePath(packageJsonPath, root) || packageJsonPath,
    },
    node: {
      version: process.version,
      minimum: packageJson.engines?.node || null,
    },
    root: normalizePath(root, root) || root,
    config: {
      path: normalizePath(configPath, root) || configPath,
      exists: fs.existsSync(configPath),
      version: Number.isInteger(config.configVersion) ? config.configVersion : null,
    },
    coordination: {
      root: normalizePath(coordinationRoot, root) || coordinationRoot,
    },
    board: {
      path: normalizePath(boardPath, root) || boardPath,
      exists: Boolean(board),
      version: Number.isInteger(board?.version) ? board.version : null,
      schemaVersion: CURRENT_BOARD_VERSION,
    },
  };
}

export function renderVersionText(info) {
  return [
    `${info.package.name} ${info.package.version}`,
    `node ${info.node.version}${info.node.minimum ? ` (requires ${info.node.minimum})` : ''}`,
    `root ${info.root}`,
    `config ${info.config.path}${info.config.exists ? ` (version ${info.config.version ?? 'unset'})` : ' (missing)'}`,
    `coordination ${info.coordination.root}`,
    `board ${info.board.path}${info.board.exists ? ` (version ${info.board.version ?? 'unset'}, schema ${info.board.schemaVersion})` : ` (missing, schema ${info.board.schemaVersion})`}`,
  ].join('\n');
}

export function runVersionCommand(argv = [], options = {}) {
  const info = buildVersionInfo(options);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(info, null, 2));
  else console.log(renderVersionText(info));
  return 0;
}
