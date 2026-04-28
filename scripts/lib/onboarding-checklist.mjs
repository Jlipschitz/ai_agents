import fs from 'node:fs';
import path from 'node:path';

import { normalizePath } from './path-utils.mjs';

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readmeMentions(root, patterns) {
  const readmePath = path.join(root, 'README.md');
  const content = readTextSafe(readmePath);
  return patterns.some((pattern) => pattern.test(content));
}

function packageHasScript(packageJson, scriptName) {
  return Boolean(packageJson?.scripts && typeof packageJson.scripts[scriptName] === 'string');
}

function configuredVisualChecks(config) {
  const checks = [
    ...(Array.isArray(config?.verification?.visualRequiredChecks) ? config.verification.visualRequiredChecks : []),
    ...(Array.isArray(config?.verification?.visualSuiteUpdateChecks) ? config.verification.visualSuiteUpdateChecks : []),
  ];
  return checks.filter(Boolean);
}

function firstExistingPath(root, paths) {
  return paths.find((entry) => fileExists(root, entry)) ?? null;
}

function buildItem({ root, id, label, paths, recommendation, required = true, ok = null, foundPath = null }) {
  const discoveredPath = foundPath ?? firstExistingPath(root, paths);
  const present = ok ?? Boolean(discoveredPath);
  return {
    id,
    label,
    required,
    ok: present || !required,
    status: present ? 'present' : required ? 'missing' : 'not-required',
    foundPath: discoveredPath ? normalizePath(discoveredPath) : null,
    paths,
    recommendation,
  };
}

export function buildOnboardingChecklist({ root, config = {}, packageJson = null } = {}) {
  const visualChecks = configuredVisualChecks(config);
  const visualWorkflowPath = typeof config?.docs?.visualWorkflow === 'string' ? config.docs.visualWorkflow.trim() : '';
  const appNotesPath = typeof config?.docs?.appNotes === 'string' ? config.docs.appNotes.trim() : '';
  const readmeHasTesting = readmeMentions(root, [/\bnpm\s+test\b/i, /\btest instructions\b/i, /\bverification\b/i]);
  const readmeHasDeployment = readmeMentions(root, [/\bdeploy(ment)?\b/i, /\brelease\b/i]);
  const items = [
    buildItem({
      root,
      id: 'architecture',
      label: 'Architecture overview',
      paths: ['docs/architecture.md', 'ARCHITECTURE.md'],
      recommendation: 'Add docs/architecture.md with the repo structure, runtime model, and major integration points.',
    }),
    buildItem({
      root,
      id: 'testing',
      label: 'Test instructions',
      paths: ['docs/testing.md', 'TESTING.md'],
      ok: readmeHasTesting || packageHasScript(packageJson, 'test'),
      foundPath: firstExistingPath(root, ['docs/testing.md', 'TESTING.md']) ?? (readmeHasTesting ? 'README.md' : null),
      recommendation: 'Document the normal test commands, required services, and expected verification evidence.',
    }),
    buildItem({
      root,
      id: 'deployment',
      label: 'Deployment notes',
      paths: ['docs/deployment.md', 'DEPLOYMENT.md', 'docs/release.md'],
      ok: readmeHasDeployment,
      foundPath: firstExistingPath(root, ['docs/deployment.md', 'DEPLOYMENT.md', 'docs/release.md']) ?? (readmeHasDeployment ? 'README.md' : null),
      recommendation: 'Add deployment or release notes covering environments, required checks, and rollback steps.',
    }),
    buildItem({
      root,
      id: 'app-notes',
      label: 'Agent-maintained app notes',
      paths: appNotesPath ? [appNotesPath] : ['docs/ai-agent-app-notes.md'],
      required: Boolean(appNotesPath),
      recommendation: 'Create the configured app notes doc so agents have a durable place for gotchas and decisions.',
    }),
    buildItem({
      root,
      id: 'visual-workflow',
      label: 'Visual workflow',
      paths: visualWorkflowPath ? [visualWorkflowPath] : ['docs/visual-workflow.md', 'docs/visual-testing.md'],
      required: visualChecks.length > 0,
      recommendation: 'Document how to run, update, and review visual verification artifacts.',
    }),
  ];
  const missing = items.filter((entry) => entry.required && entry.status === 'missing');
  return {
    ok: missing.length === 0,
    items,
    missing: missing.map((entry) => entry.id),
    recommendations: missing.map((entry) => entry.recommendation),
  };
}
