#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonFile, validateAgentConfig } from './validate-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT = process.cwd();

const DEFAULT_ENV_KEYS = [
  'AGENT_COORDINATION_CONFIG',
  'AGENT_COORDINATION_ROOT',
  'AGENT_COORDINATION_DIR',
  'AGENT_COORDINATION_CLI_ENTRYPOINT',
  'AGENT_COORDINATION_SCRIPT',
  'AGENT_COORDINATION_WATCH_LOOP_SCRIPT',
  'AGENT_COORDINATION_LOCK_WAIT_MS',
  'AGENT_TERMINAL_ID',
];

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

function parseArgs(argv) {
  const args = {
    json: false,
    config: '',
    root: ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--config') args.config = argv[++index] ?? '';
    else if (arg === '--root') args.root = path.resolve(argv[++index] ?? '.');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function resolveConfigPath(args) {
  const explicit = args.config || process.env.AGENT_COORDINATION_CONFIG || 'agent-coordination.config.json';
  return path.isAbsolute(explicit) ? explicit : path.resolve(args.root, explicit);
}

function existsRelative(root, value) {
  if (!value || typeof value !== 'string') return false;
  const target = path.isAbsolute(value) ? value : path.resolve(root, value);
  return fs.existsSync(target);
}

function inspectPaths(root, paths = []) {
  return (Array.isArray(paths) ? paths : []).map((entry) => ({
    path: entry,
    exists: existsRelative(root, entry),
  }));
}

function getEnvOverrides() {
  return Object.fromEntries(
    DEFAULT_ENV_KEYS
      .filter((key) => process.env[key] !== undefined && process.env[key] !== '')
      .map((key) => [key, process.env[key]])
  );
}

function explainConfig(config, configPath, root) {
  const validation = validateAgentConfig(config, { root });
  const docs = config.docs || {};
  const git = config.git || {};
  const capacity = config.capacity || {};
  const conflictPrediction = config.conflictPrediction || {};
  const paths = config.paths || {};
  const verification = config.verification || {};
  const pathClassification = config.pathClassification || {};
  const planning = config.planning || {};
  const agentSizing = planning.agentSizing || {};
  const domainRules = Array.isArray(config.domainRules) ? config.domainRules : [];

  const docsRoots = inspectPaths(root, docs.roots || []);
  const docsFiles = inspectPaths(root, [docs.appNotes, docs.visualWorkflow].filter(Boolean));

  const suggestions = [];
  if (!docsRoots.length) suggestions.push('Configure docs.roots so agents can discover project documentation.');
  if (docsRoots.some((entry) => !entry.exists)) suggestions.push('One or more docs.roots paths do not exist.');
  if (!Array.isArray(paths.sharedRisk) || paths.sharedRisk.length === 0) suggestions.push('Configure paths.sharedRisk for high-conflict files and folders.');
  if (!capacity.maxActiveTasksPerAgent) suggestions.push('Configure capacity.maxActiveTasksPerAgent to keep agents from carrying too much active work.');
  if (!Array.isArray(verification.visualRequiredChecks) || verification.visualRequiredChecks.length === 0) suggestions.push('No visualRequiredChecks are configured; UI-impact work may rely on manual verification.');
  if (Array.isArray(paths.visualImpact) && paths.visualImpact.length && (!Array.isArray(verification.visualRequiredChecks) || !verification.visualRequiredChecks.length)) suggestions.push('visualImpact paths exist but no visualRequiredChecks are configured.');
  if (!domainRules.length) suggestions.push('Add domainRules so plan can split work by app-specific areas.');
  if (!Array.isArray(config.agentIds) || !config.agentIds.length) suggestions.push('Configure at least one agent ID.');

  return {
    projectName: config.projectName || path.basename(root),
    root,
    configPath,
    configExists: fs.existsSync(configPath),
    validation,
    environmentOverrides: getEnvOverrides(),
    agents: {
      count: Array.isArray(config.agentIds) ? config.agentIds.length : 0,
      ids: Array.isArray(config.agentIds) ? config.agentIds : [],
    },
    docs: {
      roots: docsRoots,
      appNotes: docs.appNotes || '',
      visualWorkflow: docs.visualWorkflow || '',
      files: docsFiles,
      apiPrefixes: Array.isArray(docs.apiPrefixes) ? docs.apiPrefixes : [],
    },
    git: {
      allowMainBranchClaims: git.allowMainBranchClaims ?? true,
      allowDetachedHead: git.allowDetachedHead ?? false,
      allowedBranchPatterns: Array.isArray(git.allowedBranchPatterns) ? git.allowedBranchPatterns : [],
      defaultBaseBranch: git.defaultBaseBranch ?? 'main',
      staleBranchDays: git.staleBranchDays ?? 30,
      protectedBranchPatterns: Array.isArray(git.protectedBranchPatterns) ? git.protectedBranchPatterns : ['main', 'master', 'develop', 'dev', 'trunk', 'release/*'],
    },
    capacity: {
      maxActiveTasksPerAgent: capacity.maxActiveTasksPerAgent ?? 1,
      maxBlockedTasksPerAgent: capacity.maxBlockedTasksPerAgent ?? 1,
      preferredDomainsByAgent: capacity.preferredDomainsByAgent || {},
      enforcePreferredDomains: capacity.enforcePreferredDomains === true,
    },
    conflictPrediction: {
      enabled: conflictPrediction.enabled !== false,
      blockOnGitOverlap: conflictPrediction.blockOnGitOverlap !== false,
    },
    paths: {
      sharedRisk: paths.sharedRisk || [],
      visualImpact: paths.visualImpact || [],
      visualSuite: paths.visualSuite || [],
    },
    verification: {
      visualRequiredChecks: verification.visualRequiredChecks || [],
      visualSuiteUpdateChecks: verification.visualSuiteUpdateChecks || [],
    },
    pathClassification: {
      productPrefixes: pathClassification.productPrefixes || [],
      dataPrefixes: pathClassification.dataPrefixes || [],
      verifyPrefixes: pathClassification.verifyPrefixes || [],
      docsPrefixes: pathClassification.docsPrefixes || [],
      docsFiles: pathClassification.docsFiles || [],
    },
    planning: {
      defaultDomains: planning.defaultDomains || [],
      productFallbackPaths: planning.productFallbackPaths || [],
      dataFallbackPaths: planning.dataFallbackPaths || [],
      verifyFallbackPaths: planning.verifyFallbackPaths || [],
      docsFallbackPaths: planning.docsFallbackPaths || [],
      agentSizing: {
        minAgents: agentSizing.minAgents,
        maxAgents: agentSizing.maxAgents,
        mediumComplexityScore: agentSizing.mediumComplexityScore,
        largeComplexityScore: agentSizing.largeComplexityScore,
        productKeywords: agentSizing.productKeywords || [],
        dataKeywords: agentSizing.dataKeywords || [],
        verifyKeywords: agentSizing.verifyKeywords || [],
        docsKeywords: agentSizing.docsKeywords || [],
      },
    },
    domainRules: domainRules.map((rule) => ({
      name: rule.name,
      keywords: rule.keywords || [],
      scopes: rule.scopes || {},
    })),
    suggestions,
  };
}

function printList(title, entries) {
  console.log(title);
  if (!entries || entries.length === 0) {
    console.log('- None');
    return;
  }
  for (const entry of entries) console.log(`- ${entry}`);
}

function printPathList(title, entries) {
  console.log(title);
  if (!entries || entries.length === 0) {
    console.log('- None');
    return;
  }
  for (const entry of entries) console.log(`- ${entry.path} (${entry.exists ? 'exists' : 'missing'})`);
}

function printText(report) {
  console.log(`# Config Explanation`);
  console.log('');
  console.log(`Project: ${report.projectName}`);
  console.log(`Root: ${report.root}`);
  console.log(`Config: ${report.configPath}`);
  console.log(`Config exists: ${report.configExists ? 'yes' : 'no'}`);
  console.log(`Valid: ${report.validation.valid ? 'yes' : 'no'}`);
  console.log('');

  if (report.validation.errors.length) printList('Validation errors:', report.validation.errors);
  if (report.validation.warnings.length) printList('Validation warnings:', report.validation.warnings);

  console.log('');
  printList('Environment overrides:', Object.entries(report.environmentOverrides).map(([key, value]) => `${key}=${value}`));
  console.log('');
  printList('Agents:', report.agents.ids);
  console.log('');
  printPathList('Docs roots:', report.docs.roots);
  printPathList('Docs files:', report.docs.files);
  printList('API prefixes:', report.docs.apiPrefixes);
  console.log('');
  console.log('Git policy:');
  console.log(`- allowMainBranchClaims: ${report.git.allowMainBranchClaims}`);
  console.log(`- allowDetachedHead: ${report.git.allowDetachedHead}`);
  console.log(`- defaultBaseBranch: ${report.git.defaultBaseBranch}`);
  console.log(`- staleBranchDays: ${report.git.staleBranchDays}`);
  printList('- allowedBranchPatterns:', report.git.allowedBranchPatterns);
  printList('- protectedBranchPatterns:', report.git.protectedBranchPatterns);
  console.log('');
  console.log('Capacity policy:');
  console.log(`- maxActiveTasksPerAgent: ${report.capacity.maxActiveTasksPerAgent}`);
  console.log(`- maxBlockedTasksPerAgent: ${report.capacity.maxBlockedTasksPerAgent}`);
  console.log(`- enforcePreferredDomains: ${report.capacity.enforcePreferredDomains}`);
  printList('- preferredDomainsByAgent:', Object.entries(report.capacity.preferredDomainsByAgent).map(([agentId, domains]) => `${agentId}: ${domains.join(', ')}`));
  console.log('Conflict prediction:');
  console.log(`- enabled: ${report.conflictPrediction.enabled}`);
  console.log(`- blockOnGitOverlap: ${report.conflictPrediction.blockOnGitOverlap}`);
  console.log('');
  printList('Shared-risk paths:', report.paths.sharedRisk);
  printList('Visual-impact paths:', report.paths.visualImpact);
  printList('Visual suite paths:', report.paths.visualSuite);
  console.log('');
  printList('Visual required checks:', report.verification.visualRequiredChecks);
  printList('Visual suite update checks:', report.verification.visualSuiteUpdateChecks);
  console.log('');
  printList('Product prefixes:', report.pathClassification.productPrefixes);
  printList('Data prefixes:', report.pathClassification.dataPrefixes);
  printList('Verify prefixes:', report.pathClassification.verifyPrefixes);
  printList('Docs prefixes:', report.pathClassification.docsPrefixes);
  printList('Docs files:', report.pathClassification.docsFiles);
  console.log('');
  printList('Default domains:', report.planning.defaultDomains);
  console.log('Agent sizing:');
  console.log(`- minAgents: ${report.planning.agentSizing.minAgents ?? 'default'}`);
  console.log(`- maxAgents: ${report.planning.agentSizing.maxAgents ?? 'default'}`);
  console.log(`- mediumComplexityScore: ${report.planning.agentSizing.mediumComplexityScore ?? 'default'}`);
  console.log(`- largeComplexityScore: ${report.planning.agentSizing.largeComplexityScore ?? 'default'}`);
  console.log('');
  printList('Domain rules:', report.domainRules.map((rule) => `${rule.name}: ${(rule.keywords || []).join(', ')}`));
  console.log('');
  printList('Suggestions:', report.suggestions);
}

function printHelp() {
  console.log(`Usage: node scripts/explain-config.mjs [--json] [--config <path>] [--root <path>]\n\nExplains the active agent coordination config, environment overrides, validation result, and setup suggestions.`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const configPath = resolveConfigPath(args);
  const config = fs.existsSync(configPath) ? readJsonFile(configPath) : {};
  const report = explainConfig(config, configPath, args.root);

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);

  return report.validation.valid ? 0 : 1;
}

if (isCliEntrypoint()) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
