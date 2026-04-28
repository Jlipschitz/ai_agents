#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const DEFAULT_GITIGNORE_ENTRIES = [
  '',
  '# Local AI agent coordination runtime state',
  '/coordination/',
  '/coordination-two/',
];

const DEFAULT_PACKAGE_SCRIPTS = {
  'ai-agents': 'node ./bin/ai-agents.mjs',
  'agents': 'node ./scripts/agent-coordination.mjs',
  'agents:init': 'node ./scripts/agent-coordination.mjs init',
  'agents:plan': 'node ./scripts/agent-coordination.mjs plan',
  'agents:status': 'node ./scripts/agent-coordination.mjs status',
  'agents:validate': 'node ./scripts/agent-coordination.mjs validate',
  'agents:doctor': 'node ./scripts/agent-coordination.mjs doctor',
  'agents:heartbeat:start': 'node ./scripts/agent-coordination.mjs heartbeat-start',
  'agents:heartbeat:status': 'node ./scripts/agent-coordination.mjs heartbeat-status',
  'agents:heartbeat:stop': 'node ./scripts/agent-coordination.mjs heartbeat-stop',
  'agents:watch:start': 'node ./scripts/agent-coordination.mjs watch-start',
  'agents:watch:status': 'node ./scripts/agent-coordination.mjs watch-status',
  'agents:watch:stop': 'node ./scripts/agent-coordination.mjs watch-stop',
  'agents2': 'node ./scripts/agent-coordination-two.mjs',
  'agents2:init': 'node ./scripts/agent-coordination-two.mjs init',
  'agents2:plan': 'node ./scripts/agent-coordination-two.mjs plan',
  'agents2:status': 'node ./scripts/agent-coordination-two.mjs status',
  'agents2:validate': 'node ./scripts/agent-coordination-two.mjs validate',
  'agents2:doctor': 'node ./scripts/agent-coordination-two.mjs doctor',
  'agents2:heartbeat:start': 'node ./scripts/agent-coordination-two.mjs heartbeat-start',
  'agents2:heartbeat:status': 'node ./scripts/agent-coordination-two.mjs heartbeat-status',
  'agents2:heartbeat:stop': 'node ./scripts/agent-coordination-two.mjs heartbeat-stop',
  'agents2:watch:start': 'node ./scripts/agent-coordination-two.mjs watch-start',
  'agents2:watch:status': 'node ./scripts/agent-coordination-two.mjs watch-status',
  'agents2:watch:stop': 'node ./scripts/agent-coordination-two.mjs watch-stop',
  'agents:watch:node': 'node ./scripts/agent-watch-loop.mjs',
  'validate:agents-config': 'node ./scripts/validate-config.mjs',
};

const FILES_TO_COPY = [
  'bin/ai-agents.mjs',
  'scripts/agent-coordination-core.mjs',
  'scripts/agent-coordination.mjs',
  'scripts/agent-coordination-two.mjs',
  'scripts/agent-watch-loop.mjs',
  'scripts/agent-watch-loop.ps1',
  'scripts/agent-watch-loop-two.ps1',
  'scripts/validate-config.mjs',
  'agent-coordination.schema.json',
  'agent-coordination.config.json',
  'docs/agent-coordination-portability.md',
  'docs/commands.md',
  'docs/workflows.md',
];

export function parseArgs(argv) {
  const args = {
    target: process.cwd(),
    dryRun: false,
    force: false,
    skipDoctor: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      args.target = argv[++index];
    } else if (arg.startsWith('--target=')) {
      args.target = arg.slice('--target='.length);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--skip-doctor') {
      args.skipDoctor = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.target) {
    throw new Error('Missing --target <repo-path>.');
  }

  args.target = path.resolve(args.target);
  return args;
}

function ensureDirectory(dirPath, dryRun, operations) {
  if (fs.existsSync(dirPath)) {
    return;
  }
  operations.push(`create directory ${dirPath}`);
  if (!dryRun) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(filePath, content, dryRun, operations) {
  operations.push(`write ${filePath}`);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function copyFile(relativePath, targetRoot, options, operations) {
  const sourcePath = path.join(PACKAGE_ROOT, relativePath);
  const targetPath = path.join(targetRoot, relativePath);

  if (!fs.existsSync(sourcePath)) {
    operations.push(`skip missing source ${relativePath}`);
    return;
  }

  if (fs.existsSync(targetPath) && !options.force) {
    operations.push(`keep existing ${relativePath}`);
    return;
  }

  operations.push(`${fs.existsSync(targetPath) ? 'replace' : 'copy'} ${relativePath}`);
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function loadPackageJson(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) {
    return {
      name: path.basename(path.dirname(packageJsonPath)),
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {},
    };
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function updatePackageScripts(targetRoot, options, operations) {
  const packageJsonPath = path.join(targetRoot, 'package.json');
  const packageJson = loadPackageJson(packageJsonPath);
  packageJson.scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};

  const changed = [];
  for (const [name, command] of Object.entries(DEFAULT_PACKAGE_SCRIPTS)) {
    if (packageJson.scripts[name] !== command) {
      packageJson.scripts[name] = command;
      changed.push(name);
    }
  }

  if (changed.length === 0) {
    operations.push('package.json scripts already current');
    return;
  }

  operations.push(`update package.json scripts: ${changed.join(', ')}`);
  if (!options.dryRun) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

function updateGitignore(targetRoot, options, operations) {
  const gitignorePath = path.join(targetRoot, '.gitignore');
  const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const lines = current.split(/\r?\n/);
  const lineSet = new Set(lines.map((line) => line.trim()));
  const missing = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => entry === '' || !lineSet.has(entry));

  if (missing.filter(Boolean).length === 0) {
    operations.push('.gitignore already ignores coordination runtime folders');
    return;
  }

  const next = `${current.replace(/\s*$/, '')}\n${missing.join('\n')}\n`;
  operations.push('update .gitignore for coordination runtime folders');
  if (!options.dryRun) {
    fs.writeFileSync(gitignorePath, next);
  }
}

function ensureStarterDocs(targetRoot, options, operations) {
  const docsRoot = path.join(targetRoot, 'docs');
  ensureDirectory(docsRoot, options.dryRun, operations);

  const notesPath = path.join(docsRoot, 'ai-agent-app-notes.md');
  if (!fs.existsSync(notesPath)) {
    writeFile(notesPath, '# AI Agent App Notes\n\n## Agent-Maintained Notes\n\n', options.dryRun, operations);
  }
}

function runDoctor(targetRoot, options, operations) {
  if (options.skipDoctor || options.dryRun) {
    operations.push('skip doctor');
    return;
  }

  const packageJsonPath = path.join(targetRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    operations.push('skip doctor because package.json is missing');
    return;
  }

  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'agents:doctor'], {
      cwd: targetRoot,
      stdio: 'inherit',
    });
    operations.push('doctor completed');
  } catch (error) {
    operations.push(`doctor failed: ${error.message}`);
  }
}

export function bootstrap(targetRoot, options = {}) {
  const normalizedOptions = {
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    skipDoctor: Boolean(options.skipDoctor),
  };
  const operations = [];

  ensureDirectory(targetRoot, normalizedOptions.dryRun, operations);

  for (const relativePath of FILES_TO_COPY) {
    copyFile(relativePath, targetRoot, normalizedOptions, operations);
  }

  updatePackageScripts(targetRoot, normalizedOptions, operations);
  updateGitignore(targetRoot, normalizedOptions, operations);
  ensureStarterDocs(targetRoot, normalizedOptions, operations);
  runDoctor(targetRoot, normalizedOptions, operations);

  return operations;
}

function printHelp() {
  console.log(`Usage: npm run bootstrap -- --target <repo-path> [--force] [--dry-run] [--skip-doctor]\n\nCopies ai_agents into another repository, adds package scripts, updates .gitignore, creates starter docs, and runs doctor.`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const operations = bootstrap(args.target, args);
  for (const operation of operations) {
    console.log(`- ${operation}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
