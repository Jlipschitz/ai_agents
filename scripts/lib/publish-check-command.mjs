import fs from 'node:fs';
import path from 'node:path';

import { hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { readJsonSafe } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

const REQUIRED_FILES = ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md'];
const RECOMMENDED_FILES = ['docs/commands.md', 'docs/architecture.md', 'docs/troubleshooting.md'];
const REQUIRED_SCRIPTS = ['check', 'test', 'lint', 'jsdoc:check'];

function finding(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function hasValidPackageName(name) {
  return typeof name === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name);
}

function hasSemver(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function fileCheck(root, relativePath, level = 'error') {
  const exists = fs.existsSync(path.join(root, relativePath));
  return exists ? null : finding(level, `missing:${relativePath}`, `Missing ${relativePath}.`, { path: relativePath });
}

export function buildPublishCheck({ root = process.cwd() } = {}) {
  const packagePath = path.join(root, 'package.json');
  const packageJson = readJsonSafe(packagePath, null);
  const findings = [];
  if (!packageJson) {
    findings.push(finding('error', 'missing-package-json', 'package.json is missing or unreadable.', { path: 'package.json' }));
    return { ok: false, root: normalizePath(root, root) || root, packagePath: normalizePath(packagePath, root) || packagePath, findings, package: null };
  }

  if (!hasValidPackageName(packageJson.name)) findings.push(finding('error', 'invalid-name', 'package.json name is missing or not npm-compatible.'));
  if (!hasSemver(packageJson.version)) findings.push(finding('error', 'invalid-version', 'package.json version must be a semver value.'));
  if (packageJson.private === true) findings.push(finding('error', 'private-package', 'package.json private is true; npm publish will be blocked.'));
  if (!packageJson.license) findings.push(finding('error', 'missing-license-field', 'package.json license is missing.'));
  if (!packageJson.bin || typeof packageJson.bin['ai-agents'] !== 'string') findings.push(finding('error', 'missing-bin', 'package.json bin.ai-agents is missing.'));
  else if (!fs.existsSync(path.join(root, packageJson.bin['ai-agents']))) findings.push(finding('error', 'missing-bin-file', `bin.ai-agents target does not exist: ${packageJson.bin['ai-agents']}.`));
  for (const file of REQUIRED_FILES) {
    const result = fileCheck(root, file);
    if (result) findings.push(result);
  }
  for (const file of RECOMMENDED_FILES) {
    const result = fileCheck(root, file, 'warning');
    if (result) findings.push(result);
  }
  const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  for (const script of REQUIRED_SCRIPTS) {
    if (typeof scripts[script] !== 'string') findings.push(finding('warning', `missing-script:${script}`, `Recommended package script is missing: ${script}.`, { script }));
  }
  if (!Array.isArray(packageJson.files)) findings.push(finding('warning', 'missing-files-allowlist', 'package.json files allowlist is missing; npm will include the default package contents.'));
  return {
    ok: findings.every((entry) => entry.level !== 'error'),
    root: normalizePath(root, root) || root,
    packagePath: normalizePath(packagePath, root) || packagePath,
    package: {
      name: packageJson.name || null,
      version: packageJson.version || null,
      private: Boolean(packageJson.private),
      license: packageJson.license || null,
    },
    findings,
  };
}

export function renderPublishCheckText(result) {
  const lines = [
    '# Publish Check',
    `Package: ${result.package?.name || 'unknown'} ${result.package?.version || ''}`.trim(),
    `Status: ${result.ok ? 'ready' : 'blocked'}`,
    '',
  ];
  if (!result.findings.length) lines.push('- no findings');
  else lines.push(...result.findings.map((entry) => `- ${entry.level}: ${entry.message}`));
  return lines.join('\n');
}

export function runPublishCheck(argv, context) {
  try {
    const json = hasFlag(argv, '--json');
    const strict = hasFlag(argv, '--strict');
    const result = buildPublishCheck({ root: context.root });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(renderPublishCheckText(result));
    return strict && !result.ok ? 1 : 0;
  } catch (error) {
    return printCommandError(error.message, { json: hasFlag(argv, '--json') });
  }
}
