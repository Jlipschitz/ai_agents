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

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

const PROFILE_CHECKLIST_ITEMS = {
  react: [
    {
      id: 'ui-structure',
      label: 'UI structure notes',
      paths: ['docs/ui.md', 'docs/components.md', 'docs/frontend.md'],
      recommendation: 'Document key routes, shared components, styling conventions, and visual review expectations.',
    },
  ],
  backend: [
    {
      id: 'api-contracts',
      label: 'API contracts',
      paths: ['docs/api.md', 'docs/api-contracts.md', 'docs/openapi.md', 'openapi.yaml', 'openapi.json'],
      recommendation: 'Document API contracts, compatibility expectations, and how backend changes are verified.',
    },
    {
      id: 'data-migrations',
      label: 'Data migration notes',
      paths: ['docs/migrations.md', 'docs/database.md', 'migrations/README.md'],
      recommendation: 'Document migration workflow, rollback expectations, and required database verification.',
    },
  ],
  docs: [
    {
      id: 'docs-style-guide',
      label: 'Docs style guide',
      paths: ['docs/style-guide.md', 'docs/content-style.md', 'docs/writing.md'],
      recommendation: 'Document style, structure, and review expectations for documentation changes.',
    },
  ],
  release: [
    {
      id: 'release-process',
      label: 'Release process',
      paths: ['docs/release.md', 'RELEASE.md'],
      recommendation: 'Document release checks, approval expectations, versioning, and handoff steps.',
    },
    {
      id: 'rollback-plan',
      label: 'Rollback plan',
      paths: ['docs/rollback.md', 'docs/runbooks/rollback.md'],
      recommendation: 'Document rollback triggers, owners, commands, and post-rollback verification.',
    },
  ],
};

function configuredProfiles(config) {
  const onboarding = config?.onboarding && typeof config.onboarding === 'object' && !Array.isArray(config.onboarding) ? config.onboarding : {};
  return [...new Set([onboarding.profile, ...stringArray(onboarding.profiles)].filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim().toLowerCase()))];
}

function customChecklistItems(config) {
  const onboarding = config?.onboarding && typeof config.onboarding === 'object' && !Array.isArray(config.onboarding) ? config.onboarding : {};
  return Array.isArray(onboarding.checklist) ? onboarding.checklist : [];
}

function firstExistingPath(root, paths) {
  return paths.find((entry) => fileExists(root, entry)) ?? null;
}

function buildItem({ root, id, label, paths, recommendation, required = true, ok = null, foundPath = null, profile = null }) {
  const discoveredPath = foundPath ?? firstExistingPath(root, paths);
  const present = ok ?? Boolean(discoveredPath);
  return {
    id,
    label,
    ...(profile ? { profile } : {}),
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
  const profileItems = configuredProfiles(config).flatMap((profile) =>
    (PROFILE_CHECKLIST_ITEMS[profile] ?? []).map((item) => ({
      ...item,
      id: `${profile}-${item.id}`,
      profile,
    }))
  );
  const customItems = customChecklistItems(config).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : id;
    const paths = stringArray(item.paths);
    if (!id || !label || !paths.length) return [];
    return [{
      id,
      label,
      paths,
      required: item.required !== false,
      recommendation: typeof item.recommendation === 'string' && item.recommendation.trim() ? item.recommendation.trim() : `Add onboarding documentation for ${label}.`,
      profile: typeof item.profile === 'string' && item.profile.trim() ? item.profile.trim() : 'custom',
    }];
  });
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
    ...profileItems.map((item) => buildItem({ root, ...item })),
    ...customItems.map((item) => buildItem({ root, ...item })),
  ];
  const missing = items.filter((entry) => entry.required && entry.status === 'missing');
  return {
    ok: missing.length === 0,
    items,
    missing: missing.map((entry) => entry.id),
    recommendations: missing.map((entry) => entry.recommendation),
  };
}
