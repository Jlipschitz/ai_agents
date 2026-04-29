#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_COMMAND_ALIASES, parseCommandAliasTokens } from './lib/command-aliases.mjs';
import { printCliError } from './lib/error-formatting.mjs';
import { parseJsonText } from './lib/file-utils.mjs';
import { COMMANDS } from './lib/help-command.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function isCliEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

export function readJsonFile(filePath) {
  try {
    return parseJsonText(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message;
    throw new Error(`${filePath}: ${reason}`);
  }
}

function cloneConfigValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneConfigValue(entry));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]));
  return value;
}

function mergeArrayValues(current, patch) {
  if (patch.every((entry) => isPlainObject(entry) && typeof entry.name === 'string')) {
    const merged = current.map((entry) => cloneConfigValue(entry));
    for (const patchEntry of patch) {
      const existingIndex = merged.findIndex((entry) => isPlainObject(entry) && entry.name === patchEntry.name);
      if (existingIndex >= 0) merged[existingIndex] = mergeConfigValue(merged[existingIndex], patchEntry);
      else merged.push(cloneConfigValue(patchEntry));
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
  if (Array.isArray(patch)) return mergeArrayValues(Array.isArray(current) ? current : [], patch);
  if (isPlainObject(patch)) {
    const base = isPlainObject(current) ? cloneConfigValue(current) : {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'extends') continue;
      base[key] = mergeConfigValue(base[key], value);
    }
    return base;
  }
  return cloneConfigValue(patch);
}

function normalizeExtends(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
  return [];
}

function resolveExtendsPath(configPath, entry) {
  return path.isAbsolute(entry) ? entry : path.resolve(path.dirname(configPath), entry);
}

export function loadAgentConfigWithSources(configPath, options = {}) {
  const absolutePath = path.resolve(configPath);
  const seen = options.seen ?? new Set();
  if (seen.has(absolutePath)) throw new Error(`Config inheritance cycle detected at ${absolutePath}.`);
  seen.add(absolutePath);
  const localConfig = readJsonFile(absolutePath);
  const sources = [];
  let merged = {};

  for (const entry of normalizeExtends(localConfig.extends)) {
    const inheritedPath = resolveExtendsPath(absolutePath, entry);
    if (!fs.existsSync(inheritedPath)) throw new Error(`${absolutePath}: extended config not found: ${entry}`);
    const inherited = loadAgentConfigWithSources(inheritedPath, { ...options, seen });
    merged = mergeConfigValue(merged, inherited.config);
    sources.push(...inherited.sources);
  }

  merged = mergeConfigValue(merged, localConfig);
  sources.push(absolutePath);
  seen.delete(absolutePath);
  return { config: merged, sources };
}

export function loadAgentConfig(configPath, options = {}) {
  return loadAgentConfigWithSources(configPath, options).config;
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

function normalizeConfigPath(value) {
  return String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function isSupportedWorkspaceRootPattern(value) {
  const normalized = normalizeConfigPath(value);
  if (!normalized.includes('*')) return true;
  const starCount = [...normalized.matchAll(/\*/g)].length;
  return starCount === 1 && normalized.endsWith('/*');
}

function workspacePatternHasLocalMatch(root, value) {
  const normalized = normalizeConfigPath(value);
  if (!normalized.includes('*')) return fs.existsSync(path.resolve(root, normalized));
  if (!isSupportedWorkspaceRootPattern(normalized)) return false;
  const prefix = normalized.slice(0, -2) || '.';
  const prefixPath = path.resolve(root, prefix);
  if (!fs.existsSync(prefixPath)) return false;
  return fs.readdirSync(prefixPath, { withFileTypes: true }).some((entry) => entry.isDirectory());
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

  if ('extends' in config) {
    if (typeof config.extends === 'string') validateString(config.extends, 'extends', errors);
    else validateStringArray(config.extends, 'extends', errors);
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
    if ('defaultBaseBranch' in config.git) validateString(config.git.defaultBaseBranch, 'git.defaultBaseBranch', errors);
    if ('staleBranchDays' in config.git) validateInteger(config.git.staleBranchDays, 'git.staleBranchDays', errors, { min: 0 });
    if ('protectedBranchPatterns' in config.git) validateStringArray(config.git.protectedBranchPatterns, 'git.protectedBranchPatterns', errors);
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

  if ('ownership' in config && validateObject(config.ownership, 'ownership', errors)) {
    if ('codeownersFiles' in config.ownership) validateStringArray(config.ownership.codeownersFiles, 'ownership.codeownersFiles', errors);
    if ('broadPathPatterns' in config.ownership) validateStringArray(config.ownership.broadPathPatterns, 'ownership.broadPathPatterns', errors);
  }

  if ('policyEnforcement' in config && validateObject(config.policyEnforcement, 'policyEnforcement', errors)) {
    if ('mode' in config.policyEnforcement && !['warn', 'block'].includes(config.policyEnforcement.mode)) {
      addIssue(errors, 'policyEnforcement.mode', 'must be "warn" or "block"');
    }
    if ('rules' in config.policyEnforcement && validateObject(config.policyEnforcement.rules, 'policyEnforcement.rules', errors)) {
      for (const key of ['broadClaims', 'codeownersCrossing', 'finishRequiresApproval', 'finishRequiresDocsReview']) {
        if (key in config.policyEnforcement.rules) validateBoolean(config.policyEnforcement.rules[key], `policyEnforcement.rules.${key}`, errors);
      }
      if ('finishApprovalScope' in config.policyEnforcement.rules) {
        validateString(config.policyEnforcement.rules.finishApprovalScope, 'policyEnforcement.rules.finishApprovalScope', errors, { allowEmpty: true });
      }
    }
  }

  if ('privacy' in config && validateObject(config.privacy, 'privacy', errors)) {
    if ('mode' in config.privacy && !['standard', 'redacted', 'local-only'].includes(config.privacy.mode)) {
      addIssue(errors, 'privacy.mode', 'must be "standard", "redacted", or "local-only"');
    }
    if ('offline' in config.privacy) validateBoolean(config.privacy.offline, 'privacy.offline', errors);
    if ('redactPatterns' in config.privacy) validateStringArray(config.privacy.redactPatterns, 'privacy.redactPatterns', errors);
  }

  if ('monorepo' in config && validateObject(config.monorepo, 'monorepo', errors)) {
    if ('partialCheckout' in config.monorepo) validateBoolean(config.monorepo.partialCheckout, 'monorepo.partialCheckout', errors);
    if ('fallbackRoot' in config.monorepo) validateString(config.monorepo.fallbackRoot, 'monorepo.fallbackRoot', errors);
    if ('workspaceRoots' in config.monorepo) {
      validateStringArray(config.monorepo.workspaceRoots, 'monorepo.workspaceRoots', errors);
      for (const [index, workspaceRoot] of (Array.isArray(config.monorepo.workspaceRoots) ? config.monorepo.workspaceRoots : []).entries()) {
        if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) continue;
        if (!isSupportedWorkspaceRootPattern(workspaceRoot)) {
          addIssue(errors, `monorepo.workspaceRoots[${index}]`, 'must be an exact root or one-level wildcard ending in /*');
        } else if (config.monorepo.partialCheckout !== true && !workspacePatternHasLocalMatch(root, workspaceRoot)) {
          addIssue(warnings, `monorepo.workspaceRoots[${index}]`, `"${workspaceRoot}" has no local match; set monorepo.partialCheckout when this is expected`);
        }
      }
    }
  }

  if ('paths' in config) {
    validateKnownStringArrays(config.paths, 'paths', ['sharedRisk', 'visualSuite', 'visualSuiteDefault', 'visualImpact', 'visualImpactFiles'], errors);
  }

  if ('verification' in config) {
    validateKnownStringArrays(config.verification, 'verification', ['requiredChecks', 'visualRequiredChecks', 'visualSuiteUpdateChecks'], errors);
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

  if ('commandAliases' in config && validateObject(config.commandAliases, 'commandAliases', errors)) {
    for (const [name, value] of Object.entries(config.commandAliases)) {
      const base = `commandAliases.${name}`;
      if (!name.trim()) addIssue(errors, base, 'alias name must not be empty');
      if (/^\s*-/.test(name)) addIssue(errors, base, 'alias name must not start with "-"');
      if (/\s/.test(name)) addIssue(errors, base, 'alias name must not contain whitespace');
      if (Object.hasOwn(COMMANDS, name) || BUILT_IN_COMMAND_ALIASES.has(name)) {
        addIssue(errors, base, 'must not override a built-in command or alias');
      }

      if (typeof value !== 'string' && !Array.isArray(value)) {
        addIssue(errors, base, 'must be a string command or string array');
        continue;
      }
      if (Array.isArray(value)) validateStringArray(value, base, errors, { allowEmpty: false });
      else validateString(value, base, errors);

      const tokens = parseCommandAliasTokens(value);
      if (!tokens.length) {
        addIssue(errors, base, 'must expand to a command');
        continue;
      }
      const targetCommand = BUILT_IN_COMMAND_ALIASES.get(tokens[0])?.[0] ?? tokens[0];
      if (!Object.hasOwn(COMMANDS, targetCommand)) {
        addIssue(errors, base, `targets unknown command "${tokens[0]}"`);
      }
    }
  }

  if ('onboarding' in config && validateObject(config.onboarding, 'onboarding', errors)) {
    if ('profile' in config.onboarding) validateString(config.onboarding.profile, 'onboarding.profile', errors, { allowEmpty: true });
    if ('profiles' in config.onboarding) validateStringArray(config.onboarding.profiles, 'onboarding.profiles', errors);
    if ('checklist' in config.onboarding) {
      if (!Array.isArray(config.onboarding.checklist)) {
        addIssue(errors, 'onboarding.checklist', 'must be an array');
      } else {
        const seenChecklistIds = new Set();
        config.onboarding.checklist.forEach((item, index) => {
          const base = `onboarding.checklist[${index}]`;
          if (!validateObject(item, base, errors)) return;
          if ('id' in item) {
            validateString(item.id, `${base}.id`, errors);
            if (typeof item.id === 'string' && item.id.trim()) {
              if (seenChecklistIds.has(item.id)) {
                addIssue(errors, `${base}.id`, `duplicates "${item.id}"`);
              }
              seenChecklistIds.add(item.id);
            }
          } else {
            addIssue(errors, `${base}.id`, 'is required');
          }
          if ('label' in item) validateString(item.label, `${base}.label`, errors);
          if ('paths' in item) validateStringArray(item.paths, `${base}.paths`, errors, { allowEmpty: false });
          else addIssue(errors, `${base}.paths`, 'is required');
          if ('required' in item) validateBoolean(item.required, `${base}.required`, errors);
          if ('recommendation' in item) validateString(item.recommendation, `${base}.recommendation`, errors, { allowEmpty: true });
          if ('profile' in item) validateString(item.profile, `${base}.profile`, errors, { allowEmpty: true });
        });
      }
    }
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

  const { config, sources } = loadAgentConfigWithSources(args.config, { root: args.root });
  const result = validateAgentConfig(config, { root: args.root });

  if (args.json) {
    console.log(JSON.stringify({ ...result, configSources: sources }, null, 2));
  } else {
    for (const warning of result.warnings) {
      console.warn(`warning: ${warning}`);
    }

    if (result.valid) {
      console.log(`Config OK: ${path.relative(process.cwd(), args.config) || args.config}`);
      if (sources.length > 1) console.log(`Config sources: ${sources.map((source) => path.relative(process.cwd(), source) || source).join(' -> ')}`);
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
    printCliError(error, { argv: process.argv.slice(2) });
    process.exitCode = 1;
  }
}
