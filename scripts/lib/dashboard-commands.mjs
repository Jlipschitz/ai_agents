import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, getNumberFlag, getPositionals, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { fileTimestamp, hoursSince, readJsonDetailed, readJsonSafe, writeTextAtomicSync } from './file-utils.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';

const ACTIVE_STATUSES = new Set(['active', 'blocked', 'waiting', 'review', 'handoff']);
const STATUS_ORDER = ['planned', 'active', 'blocked', 'waiting', 'review', 'handoff', 'done', 'released'];
const VALUED_FLAGS = new Set(['--repos', '--from', '--out', '--coordination-dir', '--stale-hours', '--limit']);

function parseRepoSpec(value, root) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf('=');
  const name = separator > 0 ? trimmed.slice(0, separator).trim() : '';
  const repoPath = separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
  return {
    name: name || '',
    root: resolveRepoPath(repoPath, repoPath, root),
  };
}

function readRepoSpecsFile(filePath, root) {
  const resolved = resolveRepoPath(filePath, filePath, root);
  if (!fs.existsSync(resolved)) throw new Error(`Repository list not found: ${filePath}`);
  return fs.readFileSync(resolved, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => parseRepoSpec(line, path.dirname(resolved)))
    .filter(Boolean);
}

function parseDashboardArgs(argv, context) {
  const positionals = getPositionals(argv, VALUED_FLAGS);
  const mode = positionals[0] === 'web' ? 'web' : 'terminal';
  const positionalRepos = mode === 'web' ? positionals.slice(1) : positionals;
  const repos = [];
  const reposFlag = getFlagValue(argv, '--repos', '');
  if (reposFlag) {
    repos.push(...reposFlag.split(',').map((entry) => parseRepoSpec(entry, context.root)).filter(Boolean));
  }
  const fromFile = getFlagValue(argv, '--from', '');
  if (fromFile) repos.push(...readRepoSpecsFile(fromFile, context.root));
  repos.push(...positionalRepos.map((entry) => parseRepoSpec(entry, context.root)).filter(Boolean));
  if (!repos.length) repos.push({ name: '', root: context.root });
  return {
    mode,
    repos,
    json: hasFlag(argv, '--json'),
    apply: hasFlag(argv, '--apply'),
    strict: hasFlag(argv, '--strict'),
    staleHours: getNumberFlag(argv, '--stale-hours', 6),
    messageLimit: getNumberFlag(argv, '--limit', 5),
    coordinationDir: getFlagValue(argv, '--coordination-dir', 'coordination'),
    outPath: getFlagValue(argv, '--out', path.join('artifacts', 'dashboards', `dashboard-${fileTimestamp()}.html`)),
  };
}

function repoCoordinationRoot(repoRoot, args, context) {
  const sameRoot = path.resolve(repoRoot) === path.resolve(context.root);
  if (sameRoot && context.paths?.coordinationRoot) return context.paths.coordinationRoot;
  return path.join(repoRoot, args.coordinationDir);
}

function statusCounts(tasks) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const task of tasks) {
    const status = typeof task?.status === 'string' && task.status ? task.status : 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function recentMessages(messagesPath, limit) {
  if (!fs.existsSync(messagesPath)) return [];
  return fs.readFileSync(messagesPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        const message = JSON.parse(line);
        return {
          at: message.at || null,
          from: message.from || '',
          to: message.to || '',
          taskId: message.taskId || null,
          body: message.body || '',
        };
      } catch {
        return { at: null, from: '', to: '', taskId: null, body: line };
      }
    });
}

function taskSummary(task, staleHours) {
  const ageHours = hoursSince(task.updatedAt || task.createdAt);
  return {
    id: task.id || '',
    title: task.title || task.summary || '',
    status: task.status || 'unknown',
    ownerId: task.ownerId || null,
    claimedPaths: Array.isArray(task.claimedPaths) ? task.claimedPaths : [],
    updatedAt: task.updatedAt || task.createdAt || null,
    stale: ageHours !== null && ageHours >= staleHours,
    waitingOn: Array.isArray(task.waitingOn) ? task.waitingOn : [],
    blockedReason: task.blockedReason || task.blocker || '',
  };
}

function collectRepoDashboard(spec, args, context) {
  const repoRoot = path.resolve(spec.root);
  const coordinationRoot = repoCoordinationRoot(repoRoot, args, context);
  const config = readJsonSafe(path.join(repoRoot, 'agent-coordination.config.json'), {});
  const boardFile = readJsonDetailed(path.join(coordinationRoot, 'board.json'));
  const projectName = spec.name || boardFile.value?.projectName || config.projectName || path.basename(repoRoot);
  const base = {
    ok: !boardFile.error && boardFile.exists,
    name: projectName,
    root: normalizePath(repoRoot, context.root) || repoRoot,
    coordinationRoot: normalizePath(coordinationRoot, context.root) || coordinationRoot,
    updatedAt: boardFile.value?.updatedAt || null,
    error: null,
  };
  if (!boardFile.exists) return { ...base, ok: false, error: `Missing board.json at ${base.coordinationRoot}.`, counts: {}, agents: [], activeTasks: [], blockers: [], recentMessages: [] };
  if (boardFile.error) return { ...base, ok: false, error: `Malformed board.json: ${boardFile.error}`, counts: {}, agents: [], activeTasks: [], blockers: [], recentMessages: [] };

  const board = boardFile.value && typeof boardFile.value === 'object' ? boardFile.value : {};
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const agents = Array.isArray(board.agents) && board.agents.length
    ? board.agents
    : (Array.isArray(config.agentIds) ? config.agentIds.map((id) => ({ id, status: 'unknown', taskId: null })) : []);
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).map((task) => taskSummary(task, args.staleHours));
  const blockers = activeTasks.filter((task) => task.status === 'blocked' || task.status === 'waiting');
  return {
    ...base,
    counts: statusCounts(tasks),
    agents: agents.map((agent) => ({ id: agent.id || '', status: agent.status || 'unknown', taskId: agent.taskId || null })),
    activeTasks,
    blockers,
    recentMessages: recentMessages(path.join(coordinationRoot, 'messages.ndjson'), args.messageLimit),
  };
}

function totalCounts(repos) {
  const totals = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const repo of repos) {
    for (const [status, count] of Object.entries(repo.counts || {})) totals[status] = (totals[status] || 0) + count;
  }
  totals.activeWork = repos.reduce((sum, repo) => sum + repo.activeTasks.length, 0);
  totals.blockers = repos.reduce((sum, repo) => sum + repo.blockers.length, 0);
  totals.stale = repos.reduce((sum, repo) => sum + repo.activeTasks.filter((task) => task.stale).length, 0);
  return totals;
}

export function buildDashboard(args, context) {
  const repos = args.repos.map((repo) => collectRepoDashboard(repo, args, context));
  return {
    ok: repos.some((repo) => repo.ok) && (!args.strict || repos.every((repo) => repo.ok)),
    generatedAt: new Date().toISOString(),
    repos,
    totals: totalCounts(repos),
  };
}

function countsLine(counts) {
  return STATUS_ORDER.map((status) => `${status} ${counts[status] || 0}`).join(' | ');
}

function taskLine(task) {
  const owner = task.ownerId ? ` @${task.ownerId}` : '';
  const stale = task.stale ? ' stale' : '';
  const paths = task.claimedPaths.length ? ` | ${task.claimedPaths.join(', ')}` : '';
  return `- ${task.id} [${task.status}${stale}]${owner}: ${task.title || 'Untitled'}${paths}`;
}

function messageLine(message) {
  const route = message.from || message.to ? `${message.from || '?'} -> ${message.to || '?'}` : 'message';
  const task = message.taskId ? ` (${message.taskId})` : '';
  return `- ${route}${task}: ${message.body}`;
}

export function renderDashboardText(report) {
  const lines = ['# Coordination Dashboard', `Generated: ${report.generatedAt}`, '', `Repos: ${report.repos.length} | Active work: ${report.totals.activeWork} | Blockers: ${report.totals.blockers} | Stale: ${report.totals.stale}`, ''];
  for (const repo of report.repos) {
    lines.push(`## ${repo.name}`);
    lines.push(`Root: ${repo.root}`);
    if (!repo.ok) {
      lines.push(`Error: ${repo.error}`);
      lines.push('');
      continue;
    }
    lines.push(`Counts: ${countsLine(repo.counts)}`);
    lines.push('Agents:');
    lines.push(...(repo.agents.length ? repo.agents.map((agent) => `- ${agent.id}: ${agent.status}${agent.taskId ? ` (${agent.taskId})` : ''}`) : ['- none']));
    lines.push('Active Work:');
    lines.push(...(repo.activeTasks.length ? repo.activeTasks.map(taskLine) : ['- none']));
    lines.push('Blockers:');
    lines.push(...(repo.blockers.length ? repo.blockers.map(taskLine) : ['- none']));
    lines.push('Messages:');
    lines.push(...(repo.recentMessages.length ? repo.recentMessages.map(messageLine) : ['- none']));
    lines.push('');
  }
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function taskItems(tasks) {
  return tasks.length ? tasks.map((task) => `<li><strong>${escapeHtml(task.id)}</strong> <span>${escapeHtml(task.status)}${task.stale ? ' stale' : ''}</span>${task.ownerId ? ` <em>${escapeHtml(task.ownerId)}</em>` : ''}<br>${escapeHtml(task.title || 'Untitled')}${task.claimedPaths.length ? `<br><code>${escapeHtml(task.claimedPaths.join(', '))}</code>` : ''}</li>`).join('') : '<li>none</li>';
}

function messageItems(messages) {
  return messages.length ? messages.map((message) => `<li><strong>${escapeHtml(message.from || '?')} -> ${escapeHtml(message.to || '?')}</strong>${message.taskId ? ` <em>${escapeHtml(message.taskId)}</em>` : ''}<br>${escapeHtml(message.body)}</li>`).join('') : '<li>none</li>';
}

export function renderDashboardHtml(report) {
  const repoSections = report.repos.map((repo) => `
    <section>
      <h2>${escapeHtml(repo.name)}</h2>
      <p class="muted">${escapeHtml(repo.root)}</p>
      ${repo.ok ? `
      <div class="stats">${STATUS_ORDER.map((status) => `<span>${escapeHtml(status)} <strong>${repo.counts[status] || 0}</strong></span>`).join('')}</div>
      <div class="grid">
        <article><h3>Agents</h3><ul>${repo.agents.length ? repo.agents.map((agent) => `<li><strong>${escapeHtml(agent.id)}</strong> ${escapeHtml(agent.status)}${agent.taskId ? ` (${escapeHtml(agent.taskId)})` : ''}</li>`).join('') : '<li>none</li>'}</ul></article>
        <article><h3>Tasks</h3><ul>${taskItems(repo.activeTasks)}</ul></article>
        <article><h3>Blockers</h3><ul>${taskItems(repo.blockers)}</ul></article>
        <article><h3>Messages</h3><ul>${messageItems(repo.recentMessages)}</ul></article>
      </div>` : `<p class="error">${escapeHtml(repo.error)}</p>`}
    </section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Agents Dashboard</title>
  <style>
    body { margin: 0; font: 14px/1.45 system-ui, sans-serif; color: #202124; background: #f7f8fa; }
    header { background: #ffffff; border-bottom: 1px solid #d9dee7; padding: 24px max(24px, 7vw); }
    main { padding: 24px max(24px, 7vw); }
    h1, h2, h3 { margin: 0 0 10px; }
    section { margin: 0 0 24px; padding: 20px; background: #ffffff; border: 1px solid #d9dee7; border-radius: 8px; }
    .muted { color: #606b7a; margin: 0 0 16px; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .stats span { border: 1px solid #d9dee7; border-radius: 6px; padding: 6px 10px; background: #fbfcfe; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    article { min-width: 0; }
    ul { padding-left: 18px; margin: 0; }
    li { margin-bottom: 8px; overflow-wrap: anywhere; }
    code { color: #3d5a80; }
    .error { color: #9b1c1c; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <h1>AI Agents Dashboard</h1>
    <p class="muted">Generated ${escapeHtml(report.generatedAt)}. Repos ${report.repos.length}, active work ${report.totals.activeWork}, blockers ${report.totals.blockers}, stale ${report.totals.stale}.</p>
  </header>
  <main>
    ${repoSections}
  </main>
</body>
</html>
`;
}

export function runDashboard(argv, context) {
  try {
    const args = parseDashboardArgs(argv, context);
    const report = buildDashboard(args, context);
    if (args.mode === 'web') {
      const outputPath = resolveRepoPath(args.outPath, args.outPath, context.root);
      const html = renderDashboardHtml(report);
      const result = {
        ok: report.ok,
        applied: args.apply,
        outputPath: normalizePath(outputPath, context.root) || outputPath,
        report,
      };
      if (args.apply) writeTextAtomicSync(outputPath, html);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(args.apply ? `Dashboard written to ${result.outputPath}.` : `Dry run: would write dashboard to ${result.outputPath}.`);
        console.log(`Repos: ${report.repos.length}; active work: ${report.totals.activeWork}; blockers: ${report.totals.blockers}.`);
      }
      return report.ok ? 0 : 1;
    }
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderDashboardText(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    return printCommandError(error.message, { json: hasFlag(argv, '--json') });
  }
}
