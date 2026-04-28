import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fileExists } from './file-utils.mjs';
import { normalizePath } from './path-utils.mjs';

function normalizePaths(inputs, root) {
  return [...new Set(inputs.map((entry) => normalizePath(entry, root)).filter(Boolean))].sort();
}

function parseGitStatusPath(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const renameSeparator = ' -> ';

  if ((status.includes('R') || status.includes('C')) && rawPath.includes(renameSeparator)) {
    return rawPath.slice(rawPath.lastIndexOf(renameSeparator) + renameSeparator.length);
  }

  return rawPath;
}

function sliceAfterNthSpace(value, count) {
  let index = -1;

  for (let seen = 0; seen < count; seen += 1) {
    index = value.indexOf(' ', index + 1);
    if (index === -1) {
      return '';
    }
  }

  return value.slice(index + 1);
}

function parseGitStatusPorcelainV2(output, root) {
  const records = output.split('\0');
  const paths = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith('#')) {
      continue;
    }

    const recordType = record[0];
    if (recordType === '1') {
      paths.push(sliceAfterNthSpace(record, 8));
      continue;
    }

    if (recordType === '2') {
      paths.push(sliceAfterNthSpace(record, 9));
      index += 1;
      continue;
    }

    if (recordType === 'u') {
      paths.push(sliceAfterNthSpace(record, 10));
      continue;
    }

    if (recordType === '?') {
      paths.push(record.slice(2));
    }
  }

  return normalizePaths(paths, root);
}

function execGit(root, args) {
  const candidates = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];

  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
    }
  }

  return null;
}

function isSourceFile(filePath) {
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase());
}

export function pathStartsWith(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

export function createCorePathAnalysis(context) {
  const {
    root,
    visualSuitePaths,
    visualImpactPaths,
    visualImpactFiles,
    sharedRiskPaths,
    pathClassification,
    coordinationLabel,
    domainRules,
    ensureTaskDefaults,
  } = context;

  function getGitChangedPaths() {
    const porcelainV2Output = execGit(root, ['status', '--porcelain=v2', '-z']);

    if (porcelainV2Output != null) {
      return { available: true, paths: parseGitStatusPorcelainV2(porcelainV2Output, root) };
    }

    const shortOutput = execGit(root, ['status', '--short']);

    if (shortOutput == null) {
      return { available: false, paths: [] };
    }

    const paths = shortOutput
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => normalizePath(parseGitStatusPath(line), root))
      .filter(Boolean);

    return { available: true, paths: normalizePaths(paths, root) };
  }

  function isVisualSuitePath(filePath) {
    return visualSuitePaths.some((prefix) => pathStartsWith(filePath, prefix));
  }

  function isVisualImpactPath(filePath) {
    return (
      isVisualSuitePath(filePath) ||
      visualImpactPaths.some((prefix) => pathStartsWith(filePath, prefix)) ||
      visualImpactFiles.includes(filePath)
    );
  }

  function hasVisualImpact(paths) {
    return normalizePaths(paths, root).some((filePath) => isVisualImpactPath(filePath));
  }

  function hasVisualSuiteScope(paths) {
    return normalizePaths(paths, root).some((filePath) => isVisualSuitePath(filePath));
  }

  function hasVisualCheck(checks) {
    return checks.some((check) => check === 'visual' || check.startsWith('visual:'));
  }

  function mergeVerificationChecks(existingChecks, requiredChecks) {
    return [...new Set([...(existingChecks ?? []), ...requiredChecks])];
  }

  function isSharedRiskPath(filePath) {
    return sharedRiskPaths.some((prefix) => pathStartsWith(filePath, prefix));
  }

  function collectFilesFromClaimedPath(claimedPath, result = []) {
    const absolutePath = path.join(root, claimedPath);

    if (!fileExists(absolutePath)) {
      return result;
    }

    const stat = fs.statSync(absolutePath);

    if (stat.isFile()) {
      if (isSourceFile(claimedPath)) {
        result.push(normalizePath(claimedPath, root));
      }
      return result;
    }

    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const nextPath = normalizePath(path.join(claimedPath, entry.name), root);
      if (entry.isDirectory()) {
        collectFilesFromClaimedPath(nextPath, result);
        continue;
      }
      if (entry.isFile() && isSourceFile(nextPath)) {
        result.push(nextPath);
      }
    }

    return result;
  }

  function resolveImportPath(fromFile, specifier) {
    const candidates = [];

    if (specifier.startsWith('@/')) {
      candidates.push(path.join(root, specifier.slice(2)));
    } else if (specifier.startsWith('.')) {
      candidates.push(path.resolve(path.dirname(path.join(root, fromFile)), specifier));
    } else {
      return null;
    }

    for (const candidate of candidates) {
      const variants = [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.js`,
        `${candidate}.jsx`,
        `${candidate}.mjs`,
        `${candidate}.cjs`,
        path.join(candidate, 'index.ts'),
        path.join(candidate, 'index.tsx'),
        path.join(candidate, 'index.js'),
        path.join(candidate, 'index.jsx'),
        path.join(candidate, 'index.mjs'),
        path.join(candidate, 'index.cjs'),
      ];

      for (const variant of variants) {
        if (fileExists(variant) && fs.statSync(variant).isFile()) {
          return normalizePath(path.relative(root, variant), root);
        }
      }
    }

    return null;
  }

  function parseLocalImports(filePath) {
    const absolutePath = path.join(root, filePath);
    if (!fileExists(absolutePath)) {
      return [];
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    const matches = [...content.matchAll(/from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)];
    const imports = matches
      .map((match) => match[1] ?? match[2] ?? '')
      .map((specifier) => resolveImportPath(filePath, specifier))
      .filter(Boolean);

    return normalizePaths(imports, root);
  }

  function buildTaskFileSet(task) {
    return normalizePaths(task.claimedPaths.flatMap((claimedPath) => collectFilesFromClaimedPath(claimedPath)), root);
  }

  function collectMergeRiskWarnings(candidateTask, otherTasks) {
    const warnings = [];
    ensureTaskDefaults(candidateTask);
    const candidateFiles = buildTaskFileSet(candidateTask);
    const candidateImports = new Map(candidateFiles.map((filePath) => [filePath, parseLocalImports(filePath)]));

    for (const otherTask of otherTasks) {
      ensureTaskDefaults(otherTask);
      const otherFiles = buildTaskFileSet(otherTask);
      const otherImports = new Map(otherFiles.map((filePath) => [filePath, parseLocalImports(filePath)]));

      if (candidateTask.issueKey && otherTask.issueKey && candidateTask.issueKey === otherTask.issueKey) {
        warnings.push(`Task "${otherTask.id}" is already working the same issue key "${candidateTask.issueKey}".`);
      }

      for (const candidateFile of candidateFiles) {
        for (const importedFile of otherImports.values()) {
          if (importedFile.includes(candidateFile)) {
            warnings.push(`Task "${otherTask.id}" imports claimed file "${candidateFile}".`);
          }
        }
      }

      for (const otherFile of otherFiles) {
        for (const importedFile of candidateImports.values()) {
          if (importedFile.includes(otherFile)) {
            warnings.push(`Claimed files import "${otherFile}" from active task "${otherTask.id}".`);
          }
        }
      }

      const candidateSharedDeps = [...candidateImports.values()].flat().filter((filePath) => isSharedRiskPath(filePath));
      const otherSharedDeps = [...otherImports.values()].flat().filter((filePath) => isSharedRiskPath(filePath));
      const sharedOverlap = candidateSharedDeps.find((filePath) => otherSharedDeps.includes(filePath));
      if (sharedOverlap) {
        warnings.push(`Both tasks depend on shared hotspot "${sharedOverlap}".`);
      }

      const hotspotClaim = candidateTask.claimedPaths.find((filePath) => isSharedRiskPath(filePath));
      if (hotspotClaim) {
        const consumer = [...otherImports.values()].some((imports) => imports.some((imported) => pathStartsWith(imported, hotspotClaim) || imported === hotspotClaim));
        if (consumer) {
          warnings.push(`Task "${otherTask.id}" consumes shared hotspot claim "${hotspotClaim}".`);
        }
      }
    }

    return [...new Set(warnings)];
  }

  function classifyGitPaths(paths) {
    const buckets = {
      product: [],
      data: [],
      verify: [],
      docs: [],
    };

    for (const filePath of paths) {
      if (isVisualSuitePath(filePath)) {
        buckets.verify.push(filePath);
        continue;
      }

      if (pathClassification.productPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
        buckets.product.push(filePath);
        continue;
      }

      if (pathClassification.dataPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
        buckets.data.push(filePath);
        continue;
      }

      if (pathClassification.verifyPrefixes.some((prefix) => pathStartsWith(filePath, prefix))) {
        buckets.verify.push(filePath);
        continue;
      }

      if (
        pathClassification.docsFiles.includes(filePath) ||
        pathClassification.docsPrefixes.some((prefix) => pathStartsWith(filePath, prefix)) ||
        (coordinationLabel !== '.' && pathStartsWith(filePath, coordinationLabel))
      ) {
        buckets.docs.push(filePath);
        continue;
      }

      buckets.docs.push(filePath);
    }

    return {
      product: normalizePaths(buckets.product, root),
      data: normalizePaths(buckets.data, root),
      verify: normalizePaths(buckets.verify, root),
      docs: normalizePaths(buckets.docs, root),
    };
  }

  function inferDomainsFromPaths(paths) {
    const matched = new Set();

    for (const filePath of paths) {
      const loweredPath = filePath.toLowerCase();
      for (const rule of domainRules) {
        if (rule.keywords.some((keyword) => loweredPath.includes(keyword))) {
          matched.add(rule.name);
        }
      }
    }

    return [...matched];
  }

  return {
    classifyGitPaths,
    collectMergeRiskWarnings,
    getGitChangedPaths,
    hasVisualCheck,
    hasVisualImpact,
    hasVisualSuiteScope,
    inferDomainsFromPaths,
    isVisualSuitePath,
    mergeVerificationChecks,
    pathStartsWith,
  };
}
