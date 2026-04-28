#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildInstallManifest, COORDINATOR_DIRECTORIES } from './lib/install-manifest.mjs';
import { buildLocalPackageScripts } from './lib/package-script-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PACKAGE_SCRIPTS = buildLocalPackageScripts();
const DEFAULT_GITIGNORE_ENTRIES = [
  '',
  '# Local AI agent coordination runtime state',
  '/coordination/',
  '/coordination-two/',
  '/artifacts/',
];

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
      onboarding: { profiles: ['react'] },
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
      onboarding: { profiles: ['backend'] },
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
      onboarding: { profiles: ['docs'] },
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
      onboarding: { profiles: ['release'] },
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
