#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildInstallManifest, COORDINATOR_DIRECTORIES } from './lib/install-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const CHECK_COMMAND = 'node ./scripts/check-syntax.mjs';

const DEFAULT_GITIGNORE_ENTRIES = [
  '',
  '# Local AI agent coordination runtime state',
  '/coordination/',
  '/coordination-two/',
  '/artifacts/',
];

const DEFAULT_PACKAGE_SCRIPTS = {
  'ai-agents': 'node ./bin/ai-agents.mjs',
  'bootstrap': 'node ./scripts/bootstrap.mjs',
  'check': CHECK_COMMAND,
  'lint': 'npm run check',
  'agents': 'node ./scripts/agent-coordination.mjs',
  'agents:init': 'node ./scripts/agent-coordination.mjs init',
  'agents:plan': 'node ./scripts/agent-coordination.mjs plan',
  'agents:status': 'node ./scripts/agent-coordination.mjs status',
  'agents:validate': 'node ./scripts/agent-coordination.mjs validate',
  'agents:doctor': 'node ./scripts/agent-coordination.mjs doctor',
  'agents:doctor:json': 'node ./scripts/agent-coordination.mjs doctor --json',
  'agents:doctor:fix': 'node ./scripts/agent-coordination.mjs doctor --fix',
  'agents:explain-config': 'node ./scripts/agent-coordination.mjs explain-config',
  'agents:summarize': 'node ./scripts/agent-coordination.mjs summarize',
  'agents:start': 'node ./scripts/agent-coordination.mjs start',
  'agents:finish': 'node ./scripts/agent-coordination.mjs finish',
  'agents:handoff-ready': 'node ./scripts/agent-coordination.mjs handoff-ready',
  'agents:lock:status': 'node ./scripts/agent-coordination.mjs lock-status',
  'agents:lock:clear': 'node ./scripts/agent-coordination.mjs lock-clear --stale-only',
  'agents:heartbeat:start': 'node ./scripts/agent-coordination.mjs heartbeat-start',
  'agents:heartbeat:status': 'node ./scripts/agent-coordination.mjs heartbeat-status',
  'agents:heartbeat:stop': 'node ./scripts/agent-coordination.mjs heartbeat-stop',
  'agents:watch:start': 'node ./scripts/agent-coordination.mjs watch-start',
  'agents:watch:status': 'node ./scripts/agent-coordination.mjs watch-status',
  'agents:watch:stop': 'node ./scripts/agent-coordination.mjs watch-stop',
  'agents:watch:node': 'node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination.mjs',
  'agents:watch:diagnose': 'node ./scripts/agent-coordination.mjs watch-diagnose',
  'agents:runtime:cleanup': 'node ./scripts/agent-coordination.mjs cleanup-runtime',
  'agents:release:check': 'node ./scripts/agent-coordination.mjs release-check',
  'agents:board:inspect': 'node ./scripts/agent-coordination.mjs inspect-board',
  'agents:board:repair': 'node ./scripts/agent-coordination.mjs repair-board',
  'agents:board:migrate': 'node ./scripts/agent-coordination.mjs migrate-board',
  'agents:state:rollback': 'node ./scripts/agent-coordination.mjs rollback-state',
  'agents:state:compact': 'node ./scripts/agent-coordination.mjs compact-state',
  'agents:run-check': 'node ./scripts/agent-coordination.mjs run-check',
  'agents:policy:check': 'node ./scripts/agent-coordination.mjs policy-check',
  'agents:branches': 'node ./scripts/agent-coordination.mjs branches',
  'agents:ownership:review': 'node ./scripts/agent-coordination.mjs ownership-review',
  'agents:test-impact': 'node ./scripts/agent-coordination.mjs test-impact',
  'agents:risk:score': 'node ./scripts/agent-coordination.mjs risk-score',
  'agents:critical:path': 'node ./scripts/agent-coordination.mjs critical-path',
  'agents:health:score': 'node ./scripts/agent-coordination.mjs health-score',
  'agents:agent:history': 'node ./scripts/agent-coordination.mjs agent-history',
  'agents:contracts': 'node ./scripts/agent-coordination.mjs contracts',
  'agents:runbooks': 'node ./scripts/agent-coordination.mjs runbooks',
  'agents:path:groups': 'node ./scripts/agent-coordination.mjs path-groups',
  'agents:split:validate': 'node ./scripts/agent-coordination.mjs split-validate',
  'agents:escalation:route': 'node ./scripts/agent-coordination.mjs escalation-route',
  'agents:work:steal': 'node ./scripts/agent-coordination.mjs steal-work',
  'agents:github:status': 'node ./scripts/agent-coordination.mjs github-status',
  'agents:templates': 'node ./scripts/agent-coordination.mjs templates',
  'agents:archive:completed': 'node ./scripts/agent-coordination.mjs archive-completed',
  'agents:update': 'node ./scripts/agent-coordination.mjs update-coordinator',
  'agents:snapshot:workspace': 'node ./scripts/agent-coordination.mjs snapshot-workspace',
  'agents:backlog:import': 'node ./scripts/agent-coordination.mjs backlog-import',
  'agents:prompt': 'node ./scripts/agent-coordination.mjs prompt',
  'agents:ask': 'node ./scripts/agent-coordination.mjs ask',
  'agents:changelog': 'node ./scripts/agent-coordination.mjs changelog',
  'agents:prioritize': 'node ./scripts/agent-coordination.mjs prioritize',
  'agents:approvals': 'node ./scripts/agent-coordination.mjs approvals',
  'agents:completions': 'node ./scripts/agent-coordination.mjs completions',
  'agents2': 'node ./scripts/agent-coordination-two.mjs',
  'agents2:init': 'node ./scripts/agent-coordination-two.mjs init',
  'agents2:plan': 'node ./scripts/agent-coordination-two.mjs plan',
  'agents2:status': 'node ./scripts/agent-coordination-two.mjs status',
  'agents2:validate': 'node ./scripts/agent-coordination-two.mjs validate',
  'agents2:doctor': 'node ./scripts/agent-coordination-two.mjs doctor',
  'agents2:doctor:json': 'node ./scripts/agent-coordination-two.mjs doctor --json',
  'agents2:doctor:fix': 'node ./scripts/agent-coordination-two.mjs doctor --fix',
  'agents2:explain-config': 'node ./scripts/agent-coordination-two.mjs explain-config',
  'agents2:summarize': 'node ./scripts/agent-coordination-two.mjs summarize',
  'agents2:start': 'node ./scripts/agent-coordination-two.mjs start',
  'agents2:finish': 'node ./scripts/agent-coordination-two.mjs finish',
  'agents2:handoff-ready': 'node ./scripts/agent-coordination-two.mjs handoff-ready',
  'agents2:lock:status': 'node ./scripts/agent-coordination-two.mjs lock-status',
  'agents2:lock:clear': 'node ./scripts/agent-coordination-two.mjs lock-clear --stale-only',
  'agents2:heartbeat:start': 'node ./scripts/agent-coordination-two.mjs heartbeat-start',
  'agents2:heartbeat:status': 'node ./scripts/agent-coordination-two.mjs heartbeat-status',
  'agents2:heartbeat:stop': 'node ./scripts/agent-coordination-two.mjs heartbeat-stop',
  'agents2:watch:start': 'node ./scripts/agent-coordination-two.mjs watch-start',
  'agents2:watch:status': 'node ./scripts/agent-coordination-two.mjs watch-status',
  'agents2:watch:stop': 'node ./scripts/agent-coordination-two.mjs watch-stop',
  'agents2:watch:node': 'node ./scripts/agent-watch-loop.mjs --coordinator-script ./scripts/agent-coordination-two.mjs',
  'agents2:watch:diagnose': 'node ./scripts/agent-coordination-two.mjs watch-diagnose',
  'agents2:runtime:cleanup': 'node ./scripts/agent-coordination-two.mjs cleanup-runtime',
  'agents2:release:check': 'node ./scripts/agent-coordination-two.mjs release-check',
  'agents2:board:inspect': 'node ./scripts/agent-coordination-two.mjs inspect-board',
  'agents2:board:repair': 'node ./scripts/agent-coordination-two.mjs repair-board',
  'agents2:board:migrate': 'node ./scripts/agent-coordination-two.mjs migrate-board',
  'agents2:state:rollback': 'node ./scripts/agent-coordination-two.mjs rollback-state',
  'agents2:state:compact': 'node ./scripts/agent-coordination-two.mjs compact-state',
  'agents2:run-check': 'node ./scripts/agent-coordination-two.mjs run-check',
  'agents2:policy:check': 'node ./scripts/agent-coordination-two.mjs policy-check',
  'agents2:branches': 'node ./scripts/agent-coordination-two.mjs branches',
  'agents2:ownership:review': 'node ./scripts/agent-coordination-two.mjs ownership-review',
  'agents2:test-impact': 'node ./scripts/agent-coordination-two.mjs test-impact',
  'agents2:risk:score': 'node ./scripts/agent-coordination-two.mjs risk-score',
  'agents2:critical:path': 'node ./scripts/agent-coordination-two.mjs critical-path',
  'agents2:health:score': 'node ./scripts/agent-coordination-two.mjs health-score',
  'agents2:agent:history': 'node ./scripts/agent-coordination-two.mjs agent-history',
  'agents2:contracts': 'node ./scripts/agent-coordination-two.mjs contracts',
  'agents2:runbooks': 'node ./scripts/agent-coordination-two.mjs runbooks',
  'agents2:path:groups': 'node ./scripts/agent-coordination-two.mjs path-groups',
  'agents2:split:validate': 'node ./scripts/agent-coordination-two.mjs split-validate',
  'agents2:escalation:route': 'node ./scripts/agent-coordination-two.mjs escalation-route',
  'agents2:work:steal': 'node ./scripts/agent-coordination-two.mjs steal-work',
  'agents2:github:status': 'node ./scripts/agent-coordination-two.mjs github-status',
  'agents2:templates': 'node ./scripts/agent-coordination-two.mjs templates',
  'agents2:archive:completed': 'node ./scripts/agent-coordination-two.mjs archive-completed',
  'agents2:update': 'node ./scripts/agent-coordination-two.mjs update-coordinator',
  'agents2:snapshot:workspace': 'node ./scripts/agent-coordination-two.mjs snapshot-workspace',
  'agents2:backlog:import': 'node ./scripts/agent-coordination-two.mjs backlog-import',
  'agents2:prompt': 'node ./scripts/agent-coordination-two.mjs prompt',
  'agents2:ask': 'node ./scripts/agent-coordination-two.mjs ask',
  'agents2:changelog': 'node ./scripts/agent-coordination-two.mjs changelog',
  'agents2:prioritize': 'node ./scripts/agent-coordination-two.mjs prioritize',
  'agents2:approvals': 'node ./scripts/agent-coordination-two.mjs approvals',
  'agents2:completions': 'node ./scripts/agent-coordination-two.mjs completions',
  'validate:agents-config': 'node ./scripts/validate-config.mjs',
};

const BOOTSTRAP_PROFILES = {
  react: {
    description: 'Frontend app defaults with visual verification and UI-impact paths.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['feature/*', 'fix/*', 'agent/*'] },
      paths: {
        sharedRisk: ['app', 'src', 'components', 'features', 'assets', 'package.json'],
        visualImpact: ['app', 'src', 'components', 'features', 'assets', 'public'],
        visualSuite: ['tests/visual', 'playwright-report', 'test-results'],
        visualSuiteDefault: ['tests/visual'],
      },
      verification: { visualRequiredChecks: ['visual:test'], visualSuiteUpdateChecks: ['visual:update'] },
      checks: {
        'visual:test': {
          command: 'npm run visual:test',
          timeoutMs: 120000,
          artifactRoots: ['artifacts', 'playwright-report', 'test-results'],
          requiredForPaths: ['app', 'src', 'components', 'features'],
          requireArtifacts: true,
        },
      },
      planning: { defaultDomains: ['app'], productFallbackPaths: ['app', 'src', 'components', 'features'], verifyFallbackPaths: ['tests', 'tests/visual'] },
    },
  },
  backend: {
    description: 'Backend and data defaults for API, database, auth, and migration work.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['feature/*', 'fix/*', 'agent/*'] },
      paths: { sharedRisk: ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types', 'package.json'] },
      checks: {
        test: {
          command: 'npm test',
          timeoutMs: 120000,
          artifactRoots: ['artifacts'],
          requiredForPaths: ['api', 'server', 'lib', 'db', 'database', 'migrations'],
          requireArtifacts: false,
        },
      },
      planning: { defaultDomains: ['backend'], dataFallbackPaths: ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types'] },
      domainRules: [
        {
          name: 'backend',
          keywords: ['api', 'server', 'backend', 'database', 'db', 'schema', 'migration', 'auth'],
          scopes: {
            product: ['app', 'src'],
            data: ['api', 'server', 'lib', 'db', 'database', 'migrations', 'types'],
            verify: ['tests'],
            docs: ['README.md', 'docs'],
          },
        },
      ],
    },
  },
  docs: {
    description: 'Documentation-heavy defaults with docs-focused risk and planning paths.',
    config: {
      docs: { roots: ['docs'], appNotes: 'docs/ai-agent-app-notes.md' },
      paths: { sharedRisk: ['README.md', 'docs'], visualImpact: [], visualSuite: [], visualSuiteDefault: [] },
      verification: { visualRequiredChecks: [], visualSuiteUpdateChecks: [] },
      planning: { defaultDomains: ['docs'], productFallbackPaths: [], dataFallbackPaths: [], docsFallbackPaths: ['README.md', 'docs'] },
      domainRules: [
        {
          name: 'docs',
          keywords: ['doc', 'docs', 'documentation', 'readme', 'notes', 'guide'],
          scopes: { product: [], data: [], verify: [], docs: ['README.md', 'docs'] },
        },
      ],
    },
  },
  release: {
    description: 'Release-focused defaults with stricter branch policy, build checks, and longer artifact retention.',
    config: {
      git: { allowMainBranchClaims: false, allowDetachedHead: false, allowedBranchPatterns: ['release/*', 'hotfix/*', 'fix/*', 'agent/*', 'feature/*'] },
      policyEnforcement: { mode: 'block', rules: { finishRequiresApproval: true, finishRequiresDocsReview: true, finishApprovalScope: 'release' } },
      artifacts: { roots: ['artifacts', 'playwright-report', 'test-results'], keepDays: 30, keepFailedDays: 90, maxMb: 1000, protectPatterns: ['**/baseline/**', '**/reference/**'] },
      checks: {
        build: {
          command: 'npm run build',
          timeoutMs: 180000,
          artifactRoots: ['artifacts'],
          requiredForPaths: ['app', 'src', 'components', 'lib', 'server'],
          requireArtifacts: false,
        },
      },
    },
  },
};

const FILES_TO_COPY = buildInstallManifest(PACKAGE_ROOT, { includeConfig: true, includeDocs: true })
  .filter((relativePath) => !COORDINATOR_DIRECTORIES.some((relativeDir) => relativePath.startsWith(`${relativeDir}/`)));
const DIRECTORIES_TO_COPY = COORDINATOR_DIRECTORIES;

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfigValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneConfigValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]));
  }
  return value;
}

function mergeArrayValues(current, patch) {
  if (patch.every((entry) => isPlainObject(entry) && typeof entry.name === 'string')) {
    const merged = current.map((entry) => cloneConfigValue(entry));
    for (const patchEntry of patch) {
      const existingIndex = merged.findIndex((entry) => isPlainObject(entry) && entry.name === patchEntry.name);
      if (existingIndex >= 0) {
        merged[existingIndex] = mergeConfigValue(merged[existingIndex], patchEntry);
      } else {
        merged.push(cloneConfigValue(patchEntry));
      }
    }
    return merged;
  }

  const merged = current.map((entry) => cloneConfigValue(entry));
  const seen = new Set(merged.map((entry) => JSON.stringify(entry)));
  for (const entry of patch) {
    const key = JSON.stringify(entry);
    if (!seen.has(key)) {
      merged.push(cloneConfigValue(entry));
      seen.add(key);
    }
  }
  return merged;
}

function mergeConfigValue(current, patch) {
  if (Array.isArray(patch)) {
    return mergeArrayValues(Array.isArray(current) ? current : [], patch);
  }

  if (isPlainObject(patch)) {
    const base = isPlainObject(current) ? cloneConfigValue(current) : {};
    for (const [key, value] of Object.entries(patch)) {
      base[key] = mergeConfigValue(base[key], value);
    }
    return base;
  }

  return cloneConfigValue(patch);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfigForProfile(targetRoot) {
  const targetConfig = readJsonIfExists(path.join(targetRoot, 'agent-coordination.config.json'));
  if (targetConfig) {
    return targetConfig;
  }

  const sourceConfig = readJsonIfExists(path.join(PACKAGE_ROOT, 'agent-coordination.config.json'));
  return sourceConfig ?? {};
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeProfileName(profileName) {
  if (!profileName) {
    return '';
  }

  const normalized = String(profileName).trim().toLowerCase();
  if (!Object.hasOwn(BOOTSTRAP_PROFILES, normalized)) {
    throw new Error(`Unknown bootstrap profile "${profileName}". Available profiles: ${Object.keys(BOOTSTRAP_PROFILES).join(', ')}.`);
  }
  return normalized;
}

export function listBootstrapProfiles() {
  return Object.entries(BOOTSTRAP_PROFILES).map(([name, profile]) => ({ name, description: profile.description }));
}

export function parseArgs(argv) {
  const args = {
    target: process.cwd(),
    dryRun: false,
    force: false,
    skipDoctor: false,
    profile: '',
    listProfiles: false,
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
    } else if (arg === '--profile') {
      if (index + 1 >= argv.length) {
        throw new Error('Missing --profile <name>.');
      }
      args.profile = normalizeProfileName(argv[++index]);
    } else if (arg.startsWith('--profile=')) {
      const profileName = arg.slice('--profile='.length);
      if (!profileName) {
        throw new Error('Missing --profile <name>.');
      }
      args.profile = normalizeProfileName(profileName);
    } else if (arg === '--list-profiles') {
      args.listProfiles = true;
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

function copyDirectory(relativeDir, targetRoot, options, operations) {
  const files = buildInstallManifest(PACKAGE_ROOT, {})
    .filter((relativePath) => relativePath.startsWith(`${relativeDir}/`));
  if (!files.length) {
    operations.push(`skip missing source ${relativeDir}`);
    return;
  }

  for (const relativePath of files) {
    copyFile(relativePath, targetRoot, options, operations);
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

function inferProjectName(targetRoot) {
  const packageJson = readJsonIfExists(path.join(targetRoot, 'package.json'));
  if (packageJson?.name && typeof packageJson.name === 'string') {
    return packageJson.name;
  }
  return path.basename(targetRoot);
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

function applyBootstrapProfile(targetRoot, options, operations) {
  if (!options.profile) {
    return;
  }

  const profile = BOOTSTRAP_PROFILES[options.profile];
  const configPath = path.join(targetRoot, 'agent-coordination.config.json');
  const currentConfig = loadConfigForProfile(targetRoot);
  const nextConfig = mergeConfigValue(currentConfig, profile.config);
  if (!nextConfig.projectName || nextConfig.projectName === 'AI Agents') {
    nextConfig.projectName = inferProjectName(targetRoot);
  }
  const currentSerialized = JSON.stringify(currentConfig, null, 2);
  const nextSerialized = JSON.stringify(nextConfig, null, 2);

  if (currentSerialized === nextSerialized) {
    operations.push(`bootstrap profile ${options.profile} already applied`);
    return;
  }

  operations.push(`apply bootstrap profile ${options.profile}: ${profile.description}`);
  if (!options.dryRun) {
    writeJsonFile(configPath, nextConfig);
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
    profile: normalizeProfileName(options.profile),
  };
  const operations = [];

  ensureDirectory(targetRoot, normalizedOptions.dryRun, operations);

  for (const relativePath of FILES_TO_COPY) {
    copyFile(relativePath, targetRoot, normalizedOptions, operations);
  }
  for (const relativeDir of DIRECTORIES_TO_COPY) {
    copyDirectory(relativeDir, targetRoot, normalizedOptions, operations);
  }

  updatePackageScripts(targetRoot, normalizedOptions, operations);
  updateGitignore(targetRoot, normalizedOptions, operations);
  ensureStarterDocs(targetRoot, normalizedOptions, operations);
  applyBootstrapProfile(targetRoot, normalizedOptions, operations);
  runDoctor(targetRoot, normalizedOptions, operations);

  return operations;
}

function printHelp() {
  console.log(`Usage: npm run bootstrap -- --target <repo-path> [--profile <name>] [--force] [--dry-run] [--skip-doctor]\n\nCopies ai_agents into another repository, adds package scripts, updates .gitignore, creates starter docs, optionally applies a repo profile, and runs doctor.\n\nProfiles: ${Object.keys(BOOTSTRAP_PROFILES).join(', ')}`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.listProfiles) {
    for (const profile of listBootstrapProfiles()) {
      console.log(`${profile.name}: ${profile.description}`);
    }
    return 0;
  }

  const operations = bootstrap(args.target, args);
  for (const operation of operations) {
    console.log(`- ${operation}`);
  }
  return 0;
}

if (isCliEntrypoint()) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
