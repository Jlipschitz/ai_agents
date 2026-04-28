import fs from 'node:fs';
import path from 'node:path';

import { fileExists, nowIso } from './file-utils.mjs';
import { execGit } from './git-utils.mjs';
import { buildOnboardingChecklist } from './onboarding-checklist.mjs';
import { normalizePath } from './path-utils.mjs';

function gitignorePatternMatches(pattern, normalizedPath) {
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (!normalizedPattern) {
    return false;
  }
  if (!/[?*[\]]/.test(normalizedPattern)) {
    return normalizedPattern === normalizedPath || normalizedPath.startsWith(`${normalizedPattern}/`);
  }
  const globstarToken = '\0GLOBSTAR\0';
  const escaped = normalizedPattern
    .replace(/\*\*/g, globstarToken)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll(globstarToken, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^${escaped}(?:/.*)?$`);
  return regex.test(normalizedPath);
}

export function createDoctorCommand(context) {
  const {
    agentConfigPath,
    agentIds,
    appAgentNotesDoc,
    boardPath,
    cliRunLabel,
    coordinatorScriptPath,
    coordinationLabel,
    docsRoots,
    domainRules,
    getBoardSnapshot,
    packageJson,
    projectName,
    rawConfig,
    readAgentHeartbeats,
    readJson,
    root,
    validateBoard,
    visualRequiredChecks,
    visualSuiteUpdateChecks,
    visualWorkflowDoc,
    watchLoopScriptPath,
  } = context;

  function isRepoLocalPathIgnored(relativePath) {
    const normalized = normalizePath(relativePath);
    if (!normalized || normalized === '.') {
      return false;
    }

    if (execGit(['check-ignore', '--quiet', normalized], { root }) !== null) {
      return true;
    }

    const gitignorePath = path.join(root, '.gitignore');
    if (!fileExists(gitignorePath)) {
      return false;
    }

    return fs
      .readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .some((line) => gitignorePatternMatches(line, normalized));
  }

  function getPackageScripts() {
    const packagePath = path.join(root, 'package.json');
    if (!fileExists(packagePath)) {
      return null;
    }

    const packageJson = readJson(packagePath, null);
    return packageJson && typeof packageJson === 'object' && packageJson.scripts && typeof packageJson.scripts === 'object'
      ? packageJson.scripts
      : null;
  }

  function addPathCheck({ findings, warnings, passes }, label, relativePath, options = {}) {
    const required = options.required !== false;
    const normalized = normalizePath(relativePath);

    if (!normalized) {
      if (required) {
        findings.push(`${label} is not configured.`);
      }
      return;
    }

    if (fileExists(path.join(root, normalized))) {
      passes.push(`${label}: ${normalized}`);
      return;
    }

    const message = `${label} does not exist: ${normalized}`;
    if (required) {
      findings.push(message);
    } else {
      warnings.push(message);
    }
  }

  function doctorCommand() {
    const findings = [];
    const warnings = [];
    const passes = [];
    const check = { findings, warnings, passes };
    const onboardingChecklist = buildOnboardingChecklist({ root, config: rawConfig, packageJson });

    if (fileExists(agentConfigPath)) {
      passes.push(`Config loaded: ${normalizePath(path.relative(root, agentConfigPath))}`);
    } else {
      warnings.push('No agent-coordination.config.json found; using built-in generic defaults.');
    }

    if (agentIds.length) {
      passes.push(`Agent slots: ${agentIds.join(', ')}`);
    } else {
      findings.push('No agent slots are configured.');
    }

    addPathCheck(check, 'Coordinator script', normalizePath(path.relative(root, coordinatorScriptPath)));
    addPathCheck(check, 'Watch loop script', normalizePath(path.relative(root, watchLoopScriptPath)));

    for (const docsRoot of docsRoots) {
      addPathCheck(check, 'Docs root', docsRoot);
    }

    addPathCheck(check, 'App notes doc', appAgentNotesDoc, { required: Boolean(appAgentNotesDoc) });

    if (visualWorkflowDoc) {
      addPathCheck(check, 'Visual workflow doc', visualWorkflowDoc, {
        required: visualRequiredChecks.length > 0 || visualSuiteUpdateChecks.length > 0,
      });
    }

    const packageScripts = getPackageScripts();
    if (!packageScripts) {
      findings.push('package.json scripts could not be read.');
    } else {
      const expectedScripts = [
        'agents',
        'agents:init',
        'agents:status',
        'agents:validate',
        'agents:doctor',
        'agents2',
        'agents2:init',
        'agents2:status',
        'agents2:validate',
        'agents2:doctor',
      ];

      for (const scriptName of expectedScripts) {
        if (typeof packageScripts[scriptName] === 'string') {
          passes.push(`Package script: ${scriptName}`);
        } else {
          findings.push(`Missing package script: ${scriptName}`);
        }
      }

      for (const checkName of [...new Set([...visualRequiredChecks, ...visualSuiteUpdateChecks])]) {
        const scriptName = checkName.split(/\s+/)[0];
        if (scriptName && !packageScripts[scriptName]) {
          warnings.push(`Configured verification check has no matching npm script: ${scriptName}`);
        }
      }
    }

    if (coordinationLabel !== '.' && isRepoLocalPathIgnored(coordinationLabel)) {
      passes.push(`Runtime workspace is ignored by git: ${coordinationLabel}`);
    } else if (coordinationLabel !== '.') {
      findings.push(`Runtime workspace is not ignored by git: ${coordinationLabel}`);
    }

    if (!domainRules.length) {
      findings.push('No domain rules are configured.');
    } else {
      passes.push(`Domain rules: ${domainRules.map((rule) => rule.name).join(', ')}`);
    }

    for (const recommendation of onboardingChecklist.recommendations) {
      warnings.push(`Onboarding: ${recommendation}`);
    }

    const board = getBoardSnapshot();
    if (board) {
      const boardFindings = validateBoard(board, {
        liveHeartbeats: readAgentHeartbeats(nowIso(), { cleanupStale: false }),
      });

      if (boardFindings.length) {
        warnings.push(...boardFindings.map((finding) => `Board: ${finding}`));
      } else {
        passes.push('Current board snapshot is valid.');
      }
    } else {
      warnings.push(`No board exists yet at ${normalizePath(path.relative(root, boardPath))}. Run ${cliRunLabel(':init')} to initialize.`);
    }

    const lines = ['Agent coordination doctor', ''];
    lines.push(`Project: ${projectName}`);
    lines.push(`Workspace: ${coordinationLabel}`);
    lines.push(`Config: ${fileExists(agentConfigPath) ? normalizePath(path.relative(root, agentConfigPath)) : 'built-in generic defaults'}`);
    lines.push('');
    lines.push(`Passes (${passes.length}):`);
    lines.push(...(passes.length ? passes.map((entry) => `- ${entry}`) : ['- none']));
    lines.push('');
    lines.push(`Warnings (${warnings.length}):`);
    lines.push(...(warnings.length ? warnings.map((entry) => `- ${entry}`) : ['- none']));
    lines.push('');
    lines.push('Onboarding checklist:');
    lines.push(
      ...onboardingChecklist.items.map((item) => {
        const location = item.foundPath ? ` (${item.foundPath})` : '';
        return `- ${item.status}: ${item.label}${location}`;
      })
    );
    lines.push('');
    lines.push(`Findings (${findings.length}):`);
    lines.push(...(findings.length ? findings.map((entry) => `- ${entry}`) : ['- none']));

    console.log(lines.join('\n'));
    process.exitCode = findings.length ? 1 : 0;
  }

  return { doctorCommand };
}
