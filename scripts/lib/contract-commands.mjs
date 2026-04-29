import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { nowIso, readJsonSafe, writeJson } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';

const CONTRACT_VERSION = 1;
const VALID_STATUSES = new Set(['draft', 'active', 'deprecated']);
const DEFAULT_CONTRACT_PATHS = ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types'];

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizePath(entry))
    .filter(Boolean);
}

function contractId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pathMatchesScope(filePath, scope) {
  const normalizedPath = normalizePath(filePath);
  const normalizedScope = normalizePath(scope);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function contractRoot(paths) {
  return path.join(paths.coordinationRoot, 'contracts');
}

function contractFilePath(paths, id) {
  return path.join(contractRoot(paths), `${id}.json`);
}

function readContractFile(filePath) {
  return readJsonSafe(filePath, null);
}

function loadContracts(paths) {
  const root = contractRoot(paths);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => ({ path: path.join(root, entry), contract: readContractFile(path.join(root, entry)) }))
    .filter((entry) => entry.contract && typeof entry.contract === 'object')
    .map((entry) => ({ ...entry.contract, filePath: entry.path }));
}

function buildContract(argv, context) {
  const positionals = getPositionals(argv, new Set(['--owner', '--scope', '--scopes', '--summary', '--producer', '--consumers', '--consumer', '--status']));
  const id = contractId(positionals[1]);
  const ownerId = getFlagValue(argv, '--owner', '');
  const scopes = splitList(getFlagValue(argv, '--scope', getFlagValue(argv, '--scopes', '')));
  const summary = getFlagValue(argv, '--summary', positionals.slice(2).join(' ')).trim();
  const producerTaskId = getFlagValue(argv, '--producer', '');
  const consumerTaskIds = splitList(getFlagValue(argv, '--consumers', getFlagValue(argv, '--consumer', '')));
  const status = getFlagValue(argv, '--status', 'draft');
  const timestamp = nowIso();
  return {
    contractVersion: CONTRACT_VERSION,
    id,
    status,
    summary,
    ownerId,
    scopes,
    producerTaskId: producerTaskId || null,
    consumerTaskIds,
    createdAt: timestamp,
    updatedAt: timestamp,
    notes: [],
    source: {
      projectName: context.board?.projectName || path.basename(context.root),
    },
  };
}

function validateContract(contract, board) {
  const errors = [];
  const warnings = [];
  const tasks = new Map((Array.isArray(board?.tasks) ? board.tasks : []).map((task) => [task.id, task]));
  if (!contract || typeof contract !== 'object') return { errors: ['Contract is not an object.'], warnings };
  if (!contract.id) errors.push('Contract id is required.');
  if (!VALID_STATUSES.has(contract.status)) errors.push(`Contract ${contract.id || '(unknown)'} has invalid status ${contract.status}.`);
  if (!stringArray(contract.scopes).length) errors.push(`Contract ${contract.id || '(unknown)'} must include at least one scope.`);
  if (!contract.summary) warnings.push(`Contract ${contract.id || '(unknown)'} has no summary.`);
  if (contract.producerTaskId && !tasks.has(contract.producerTaskId)) errors.push(`Contract ${contract.id} references missing producer task ${contract.producerTaskId}.`);
  for (const taskId of stringArray(contract.consumerTaskIds)) {
    if (!tasks.has(taskId)) errors.push(`Contract ${contract.id} references missing consumer task ${taskId}.`);
  }
  return { errors, warnings };
}

function contractCoversPath(contract, filePath) {
  return stringArray(contract.scopes).some((scope) => pathMatchesScope(filePath, scope));
}

function configuredContractPaths(config) {
  const dataPrefixes = stringArray(config.pathClassification?.dataPrefixes);
  return dataPrefixes.length ? dataPrefixes : DEFAULT_CONTRACT_PATHS;
}

function uncoveredContractWork({ config, board, contracts }) {
  const contractPaths = configuredContractPaths(config);
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const activeLike = new Set(['planned', 'active', 'blocked', 'waiting', 'review', 'handoff']);
  const activeContracts = contracts.filter((contract) => contract.status !== 'deprecated');
  const warnings = [];
  for (const task of tasks) {
    if (!activeLike.has(task.status)) continue;
    const paths = stringArray(task.claimedPaths);
    const contractPathsTouched = paths.filter((filePath) => contractPaths.some((scope) => pathMatchesScope(filePath, scope)));
    if (!contractPathsTouched.length) continue;
    const covered = contractPathsTouched.some((filePath) => activeContracts.some((contract) => contractCoversPath(contract, filePath)));
    if (!covered) warnings.push(`Task ${task.id} touches contract-sensitive path(s) without a contract: ${contractPathsTouched.join(', ')}.`);
  }
  return warnings;
}

function buildContractCheck(context) {
  const contracts = loadContracts(context.paths);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (const contract of contracts) {
    if (seen.has(contract.id)) errors.push(`Duplicate contract id ${contract.id}.`);
    seen.add(contract.id);
    const result = validateContract(contract, context.board);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  warnings.push(...uncoveredContractWork({ config: context.config, board: context.board, contracts }));
  return { ok: errors.length === 0, contracts, errors, warnings };
}

function renderContract(contract) {
  return [
    `${contract.id} [${contract.status}]`,
    `Summary: ${contract.summary || '(none)'}`,
    `Owner: ${contract.ownerId || '(none)'}`,
    `Scopes: ${stringArray(contract.scopes).join(', ') || '(none)'}`,
    `Producer: ${contract.producerTaskId || '(none)'}`,
    `Consumers: ${stringArray(contract.consumerTaskIds).join(', ') || '(none)'}`,
  ].join('\n');
}

function runContractsList(argv, context) {
  const contracts = loadContracts(context.paths);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify({ contracts }, null, 2));
  else console.log(contracts.length ? contracts.map((contract) => `- ${contract.id} [${contract.status}] ${contract.summary || ''}`).join('\n') : '- no contracts');
  return 0;
}

function runContractsShow(argv, context) {
  const id = contractId(getPositionals(argv).at(1));
  const contract = loadContracts(context.paths).find((entry) => entry.id === id);
  if (!contract) {
    return printCommandError(`Contract not found: ${id}`, { json: hasFlag(argv, '--json'), code: 'not_found' });
  }
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(contract, null, 2));
  else console.log(renderContract(contract));
  return 0;
}

function runContractsCreate(argv, context) {
  const json = hasFlag(argv, '--json');
  const apply = hasFlag(argv, '--apply');
  const contract = buildContract(argv, context);
  const validation = validateContract(contract, context.board);
  if (!contract.id) validation.errors.push('Usage: contracts create <id> --owner <agent> --scope <path[,path...]> --summary <text> [--apply]');
  if (!contract.ownerId) validation.warnings.push(`Contract ${contract.id || '(unknown)'} has no owner.`);
  const filePath = contract.id ? contractFilePath(context.paths, contract.id) : null;
  const exists = filePath && fs.existsSync(filePath);
  if (exists) validation.errors.push(`Contract already exists: ${contract.id}.`);
  const result = { ok: validation.errors.length === 0, applied: false, contract, filePath, validation };
  if (apply && result.ok) {
    const root = contractRoot(context.paths);
    withStateTransactionSync([root], () => {
      fs.mkdirSync(root, { recursive: true });
      writeJson(filePath, contract);
    });
    result.applied = true;
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(apply ? 'Contract create applied.' : 'Contract create dry run.');
    console.log(renderContract(contract));
    if (validation.errors.length) console.log(`Errors:\n${validation.errors.map((entry) => `- ${entry}`).join('\n')}`);
    if (validation.warnings.length) console.log(`Warnings:\n${validation.warnings.map((entry) => `- ${entry}`).join('\n')}`);
  }
  return result.ok ? 0 : 1;
}

function runContractsCheck(argv, context) {
  const result = buildContractCheck(context);
  if (hasFlag(argv, '--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('# Contract Check');
    console.log(`Contracts: ${result.contracts.length}`);
    console.log(result.errors.length ? result.errors.map((entry) => `- error: ${entry}`).join('\n') : '- no contract errors');
    if (result.warnings.length) console.log(result.warnings.map((entry) => `- warning: ${entry}`).join('\n'));
  }
  return result.ok ? 0 : 1;
}

export function runContracts(argv, context) {
  const subcommand = getPositionals(argv).at(0) || 'list';
  if (subcommand === 'list') return runContractsList(argv, context);
  if (subcommand === 'show') return runContractsShow(argv, context);
  if (subcommand === 'create') return runContractsCreate(argv, context);
  if (subcommand === 'check') return runContractsCheck(argv, context);
  const usage = 'Usage: contracts list|show <id>|create <id>|check [options]';
  return printCommandError(usage, { json: hasFlag(argv, '--json'), code: 'usage_error' });
}
