#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

export function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message;
    throw new Error(`${filePath}: ${reason}`);
  }
}

function addIssue(issues, pathLabel, message) {
  issues.push(`${pathLabel}: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateString(value, pathLabel, errors, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    addIssue(errors, pathLabel, 'must be a string');
    return;
  }

  if (!allowEmpty && value.trim() === '') {
    addIssue(errors, pathLabel, 'must not be empty');
  }
}

function validateBoolean(value, pathLabel, errors) {
  if (typeof value !== 'boolean') {
    addIssue(errors, pathLabel, 'must be a boolean');
  }
}

function validateObject(value, pathLabel, errors) {
  if (!isPlainObject(value)) {
    addIssue(errors, pathLabel, 'must be an object');
    return false;
  }
  return true;
}

function validateStringArray(value, pathLabel, errors, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    addIssue(errors, pathLabel, 'must be an array');
    return;
  }

  if (!allowEmpty && value.length === 0) {
    addIssue(errors, pathLabel, 'must include at least one item');
  }

  const seen = new Set();
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      addIssue(errors, `${pathLabel}[${index}]`, 'must be a string');
      return;
    }

    if (entry.trim() === '') {
      addIssue(errors, `${pathLabel}[${index}]`, 'must not be empty');
    }

    if (seen.has(entry)) {
      addIssue(errors, `${pathLabel}[${index}]`, `duplicates "${entry}"`);
    }
    seen.add(entry);
  });
}

function validateInteger(value, pathLabel, errors, { min = 1 } = {}) {
  if (!Number.isInteger(value)) {
    addIssue(errors, pathLabel, 'must be an integer');
    return;
  }

  if (value < min) {
    addIssue(errors, pathLabel, `must be at least ${min}`);
  }
}

function validateKnownStringArrays(parent, pathLabel, keys, errors) {
  if (!validateObject(parent, pathLabel, errors)) {
    return;
  }

  for (const key of keys) {
    if (key in parent) {
      validateStringArray(parent[key], `${pathLabel}.${key}`, errors);
    }
  }
}

export function validateAgentConfig(config, options = {}) {
  const errors = [];
  const warnings = [];
  const root = options.root ? path.resolve(options.root) : REPO_ROOT;

  if (!validateObject(config, 'config', errors)) {
    return { valid: false, errors, warnings };
  }

  for (const key of ['projectName', 'agentIds', 'docs', 'paths', 'verification', 'pathClassification', 'planning', 'domainRules']) {
    if (!(key in config)) {
      addIssue(errors, key, 'is required');
    }
  }

  if ('projectName' in config) {
    validateString(config.projectName, 'projectName', errors);
  }

  if ('configVersion' in config) {
    validateInteger(config.configVersion, 'configVersion', errors);
  }

  if ('agentIds' in config) {
    validateStringArray(config.agentIds, 'agentIds', errors, { allowEmpty: false });
  }

  if ('docs' in config && validateObject(config.docs, 'docs', errors)) {
    if ('roots' in config.docs) {
      validateStringArray(config.docs.roots, 'docs.roots', errors);
      for (const docsRoot of config.docs.roots ?? []) {
        if (typeof docsRoot === 'string' && docsRoot.trim() && !fs.existsSync(path.resolve(root, docsRoot))) {
          addIssue(warnings, 'docs.roots', `"${docsRoot}" does not exist yet`);
        }
      }
    }
    if ('appNotes' in config.docs) validateString(config.docs.appNotes, 'docs.appNotes', errors, { allowEmpty: true });
    if ('visualWorkflow' in config.docs) validateString(config.docs.visualWorkflow, 'docs.visualWorkflow', errors, { allowEmpty: true });
    if ('apiPrefixes' in config.docs) validateStringArray(config.docs.apiPrefixes, 'docs.apiPrefixes', errors);
  }

  if ('git' in config && validateObject(config.git, 'git', errors)) {
    if ('allowMainBranchClaims' in config.git) validateBoolean(config.git.allowMainBranchClaims, 'git.allowMainBranchClaims', errors);
    if ('allowDetachedHead' in config.git) validateBoolean(config.git.allowDetachedHead, 'git.allowDetachedHead', errors);
    if ('allowedBranchPatterns' in config.git) validateStringArray(config.git.allowedBranchPatterns, 'git.allowedBranchPatterns', errors);
  }

  if ('capacity' in config && validateObject(config.capacity, 'capacity', errors)) {
    if ('maxActiveTasksPerAgent' in config.capacity) validateInteger(config.capacity.maxActiveTasksPerAgent, 'capacity.maxActiveTasksPerAgent', errors);
    if ('maxBlockedTasksPerAgent' in config.capacity) validateInteger(config.capacity.maxBlockedTasksPerAgent, 'capacity.maxBlockedTasksPerAgent', errors, { min: 0 });
    if ('enforcePreferredDomains' in config.capacity) validateBoolean(config.capacity.enforcePreferredDomains, 'capacity.enforcePreferredDomains', errors);
    if ('preferredDomainsByAgent' in config.capacity && validateObject(config.capacity.preferredDomainsByAgent, 'capacity.preferredDomainsByAgent', errors)) {
      for (const [agentId, domains] of Object.entries(config.capacity.preferredDomainsByAgent)) {
        validateStringArray(domains, `capacity.preferredDomainsByAgent.${agentId}`, errors);
        if (Array.isArray(config.agentIds) && !config.agentIds.includes(agentId)) {
          addIssue(warnings, `capacity.preferredDomainsByAgent.${agentId}`, 'does not match a configured agentId');
        }
      }
    }
  }

  if ('conflictPrediction' in config && validateObject(config.conflictPrediction, 'conflictPrediction', errors)) {
    if ('enabled' in config.conflictPrediction) validateBoolean(config.conflictPrediction.enabled, 'conflictPrediction.enabled', errors);
    if ('blockOnGitOverlap' in config.conflictPrediction) validateBoolean(config.conflictPrediction.blockOnGitOverlap, 'conflictPrediction.blockOnGitOverlap', errors);
  }

  if ('paths' in config) {
    validateKnownStringArrays(config.paths, 'paths', ['sharedRisk', 'visualSuite', 'visualSuiteDefault', 'visualImpact', 'visualImpactFiles'], errors);
  }

  if ('verification' in config) {
    validateKnownStringArrays(config.verification, 'verification', ['visualRequiredChecks', 'visualSuiteUpdateChecks'], errors);
  }

  if ('artifacts' in config && validateObject(config.artifacts, 'artifacts', errors)) {
    if ('roots' in config.artifacts) validateStringArray(config.artifacts.roots, 'artifacts.roots', errors);
    if ('protectPatterns' in config.artifacts) validateStringArray(config.artifacts.protectPatterns, 'artifacts.protectPatterns', errors);
    for (const key of ['keepDays', 'keepFailedDays', 'maxMb']) {
      if (key in config.artifacts) validateInteger(config.artifacts[key], `artifacts.${key}`, errors);
    }
  }

  if ('checks' in config && validateObject(config.checks, 'checks', errors)) {
    for (const [name, check] of Object.entries(config.checks)) {
      const base = `checks.${name}`;
      if (!validateObject(check, base, errors)) continue;
      if ('command' in check) validateString(check.command, `${base}.command`, errors);
      if ('timeoutMs' in check) validateInteger(check.timeoutMs, `${base}.timeoutMs`, errors, { min: 1000 });
      if ('artifactRoots' in check) validateStringArray(check.artifactRoots, `${base}.artifactRoots`, errors);
      if ('requiredForPaths' in check) validateStringArray(check.requiredForPaths, `${base}.requiredForPaths`, errors);
      if ('requireArtifacts' in check) validateBoolean(check.requireArtifacts, `${base}.requireArtifacts`, errors);
    }
  }

  if ('notes' in config && validateObject(config.notes, 'notes', errors)) {
    if ('categories' in config.notes) validateStringArray(config.notes.categories, 'notes.categories', errors);
    if ('sectionHeading' in config.notes) validateString(config.notes.sectionHeading, 'notes.sectionHeading', errors, { allowEmpty: true });
  }

  if ('pathClassification' in config) {
    validateKnownStringArrays(config.pathClassification, 'pathClassification', ['productPrefixes', 'dataPrefixes', 'verifyPrefixes', 'docsPrefixes', 'docsFiles'], errors);
  }

  if ('planning' in config && validateObject(config.planning, 'planning', errors)) {
    for (const key of ['defaultDomains', 'productFallbackPaths', 'dataFallbackPaths', 'verifyFallbackPaths', 'docsFallbackPaths']) {
      if (key in config.planning) validateStringArray(config.planning[key], `planning.${key}`, errors);
    }

    if ('agentSizing' in config.planning && validateObject(config.planning.agentSizing, 'planning.agentSizing', errors)) {
      for (const key of ['minAgents', 'maxAgents', 'mediumComplexityScore', 'largeComplexityScore']) {
        if (key in config.planning.agentSizing) validateInteger(config.planning.agentSizing[key], `planning.agentSizing.${key}`, errors);
      }

      for (const key of ['productKeywords', 'dataKeywords', 'verifyKeywords', 'docsKeywords']) {
        if (key in config.planning.agentSizing) validateStringArray(config.planning.agentSizing[key], `planning.agentSizing.${key}`, errors);
      }

      const minAgents = config.planning.agentSizing.minAgents;
      const maxAgents = config.planning.agentSizing.maxAgents;
      if (Number.isInteger(minAgents) && Number.isInteger(maxAgents) && minAgents > maxAgents) {
        addIssue(errors, 'planning.agentSizing', 'minAgents cannot be greater than maxAgents');
      }

      if (Array.isArray(config.agentIds) && Number.isInteger(maxAgents) && maxAgents > config.agentIds.length) {
        addIssue(warnings, 'planning.agentSizing.maxAgents', 'is greater than the number of configured agentIds');
      }
    }
  }

  if ('domainRules' in config) {
    if (!Array.isArray(config.domainRules)) {
      addIssue(errors, 'domainRules', 'must be an array');
    } else {
      config.domainRules.forEach((rule, index) => {
        const base = `domainRules[${index}]`;
        if (!validateObject(rule, base, errors)) return;
        if ('name' in rule) validateString(rule.name, `${base}.name`, errors);
        else addIssue(errors, `${base}.name`, 'is required');
        if ('keywords' in rule) validateStringArray(rule.keywords, `${base}.keywords`, errors, { allowEmpty: false });
        else addIssue(errors, `${base}.keywords`, 'is required');
        if ('scopes' in rule) validateKnownStringArrays(rule.scopes, `${base}.scopes`, ['product', 'data', 'verify', 'docs'], errors);
        else addIssue(errors, `${base}.scopes`, 'is required');
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function parseArgs(argv) {
  const parsed = {
    config: path.join(REPO_ROOT, 'agent-coordination.config.json'),
    root: REPO_ROOT,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      parsed.config = path.resolve(argv[++index] ?? '');
    } else if (arg === '--root') {
      parsed.root = path.resolve(argv[++index] ?? '');
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-config.mjs [--config <path>] [--root <repo>] [--json]\n\nValidates agent-coordination.config.json and prints actionable errors.`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const config = readJsonFile(args.config);
  const result = validateAgentConfig(config, { root: args.root });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const warning of result.warnings) {
      console.warn(`warning: ${warning}`);
    }

    if (result.valid) {
      console.log(`Config OK: ${path.relative(process.cwd(), args.config) || args.config}`);
    } else {
      console.error(`Config invalid: ${path.relative(process.cwd(), args.config) || args.config}`);
      for (const error of result.errors) {
        console.error(`- ${error}`);
      }
    }
  }

  return result.valid ? 0 : 1;
}

if (isCliEntrypoint()) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
