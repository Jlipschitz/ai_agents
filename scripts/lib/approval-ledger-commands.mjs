import { nowIso } from './file-utils.mjs';

export const VALID_APPROVAL_STATUSES = new Set(['pending', 'approved', 'denied', 'used']);

function normalizeScope(value, slugify) {
  return slugify(String(value ?? '').trim());
}

function getApprovals(board) {
  board.approvals = Array.isArray(board.approvals) ? board.approvals : [];
  return board.approvals;
}

function approvalMatches(approval, filters = {}) {
  if (filters.taskId && approval.taskId !== filters.taskId) return false;
  if (filters.status && approval.status !== filters.status) return false;
  if (filters.scope && approval.scope !== filters.scope) return false;
  return true;
}

function renderApproval(approval) {
  const decision = approval.decidedBy ? ` | decided by ${approval.decidedBy}` : '';
  const used = approval.usedBy ? ` | used by ${approval.usedBy}` : '';
  return `- ${approval.id}: ${approval.status} | task ${approval.taskId} | scope ${approval.scope} | requested by ${approval.requestedBy}${decision}${used} | ${approval.summary}`;
}

function activeApprovalForTask(board, taskId, scope = '') {
  const normalizedScope = scope || '';
  return getApprovals(board).find((approval) =>
    approval.taskId === taskId
    && (approval.status === 'approved' || approval.status === 'used')
    && (!normalizedScope || approval.scope === normalizedScope)
  ) ?? null;
}

export function createApprovalLedgerCommands(context) {
  const {
    appendJournalLine,
    ensureTask,
    getAgent,
    getBoard,
    getCommandAgent,
    getReadOnlyBoard,
    note,
    saveBoard,
    slugify,
    withMutationLock,
  } = context;

  function listApprovalsCommand(positionals, options = {}) {
    const json = options.json === true || String(options.json ?? '').toLowerCase() === 'true';
    const board = getReadOnlyBoard();
    const status = typeof options.status === 'string' ? options.status.trim().toLowerCase() : '';
    const taskId = typeof options.task === 'string' ? options.task.trim() : '';
    const scope = typeof options.scope === 'string' ? normalizeScope(options.scope, slugify) : '';

    if (status && !VALID_APPROVAL_STATUSES.has(status)) {
      throw new Error(`Invalid approval status "${status}". Expected one of: ${[...VALID_APPROVAL_STATUSES].join(', ')}.`);
    }

    const approvals = getApprovals(board).filter((approval) => approvalMatches(approval, { taskId, status, scope }));
    const result = { ok: true, approvals };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(approvals.length ? approvals.map(renderApproval).join('\n') : 'No approvals found.');
  }

  function checkApprovalCommand(positionals, options = {}) {
    const [taskId] = positionals;
    const json = options.json === true || String(options.json ?? '').toLowerCase() === 'true';
    if (!taskId) throw new Error('Usage: approvals check <task-id> [--scope <scope>] [--json]');
    const board = getReadOnlyBoard();
    const scope = typeof options.scope === 'string' ? normalizeScope(options.scope, slugify) : '';
    const approval = activeApprovalForTask(board, taskId, scope);
    const result = { ok: Boolean(approval), taskId, scope: scope || null, approval: approval ?? null };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(approval ? `Approval found: ${approval.id} (${approval.status}).` : `No approved ledger entry found for ${taskId}${scope ? ` scope ${scope}` : ''}.`);
    return result.ok ? 0 : 1;
  }

  async function requestApprovalCommand(positionals) {
    const [agentId, taskId, rawScope, ...summaryParts] = positionals;
    const summary = summaryParts.join(' ').trim();
    const scope = normalizeScope(rawScope, slugify);

    if (!agentId || !taskId || !scope || !summary) {
      throw new Error('Usage: approvals request <agent> <task-id> <scope> <summary>');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      const agent = getCommandAgent(board, agentId);
      if (task.ownerId && task.ownerId !== agentId) {
        throw new Error(`${agentId} cannot request approval for "${taskId}" because it is currently owned by ${task.ownerId}.`);
      }

      const approvals = getApprovals(board);
      const existing = approvals.find((approval) => approval.taskId === taskId && approval.scope === scope && approval.status === 'pending');
      if (existing) {
        throw new Error(`Approval scope "${scope}" already has a pending request for ${taskId}: ${existing.id}.`);
      }

      const timestamp = nowIso();
      const id = `approval-${slugify(taskId)}-${scope}-${Date.now()}`;
      approvals.push({
        id,
        taskId,
        scope,
        summary,
        status: 'pending',
        requestedBy: agentId,
        requestedAt: timestamp,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        usedBy: null,
        usedAt: null,
        useNote: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      task.updatedAt = timestamp;
      note(task, agentId, 'approval-request', `Requested approval for ${scope}. ${summary}`);
      agent.updatedAt = timestamp;
      appendJournalLine(`- ${timestamp} | ${agentId} requested approval \`${id}\` for \`${taskId}\` scope \`${scope}\`: ${summary}`);
      await saveBoard(board);
      console.log(`Created approval request ${id}.`);
    });
  }

  async function resolveApprovalCommand(positionals, nextStatus, options = {}) {
    const [approvalId] = positionals;
    const actingAgent = typeof options.by === 'string' && options.by.trim() ? options.by.trim() : '';
    const noteText = typeof options.note === 'string' ? options.note.trim() : '';
    if (!approvalId || !actingAgent) {
      throw new Error(`Usage: approvals ${nextStatus === 'approved' ? 'grant' : 'deny'} <approval-id> --by <agent> [--note <text>]`);
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getAgent(board, actingAgent);
      const approval = getApprovals(board).find((entry) => entry.id === approvalId);
      if (!approval) throw new Error(`Unknown approval "${approvalId}".`);
      if (approval.status !== 'pending') throw new Error(`Approval "${approvalId}" is already ${approval.status}.`);

      const timestamp = nowIso();
      approval.status = nextStatus;
      approval.decidedBy = actingAgent;
      approval.decidedAt = timestamp;
      approval.decisionNote = noteText || null;
      approval.updatedAt = timestamp;

      const task = approval.taskId ? ensureTask(board, approval.taskId) : null;
      if (task) {
        task.updatedAt = timestamp;
        note(task, actingAgent, `approval-${nextStatus}`, `${nextStatus} approval ${approvalId} for ${approval.scope}.${noteText ? ` ${noteText}` : ''}`);
      }

      appendJournalLine(`- ${timestamp} | ${actingAgent} ${nextStatus} approval \`${approvalId}\`${noteText ? `: ${noteText}` : ''}`);
      await saveBoard(board);
      console.log(`Marked approval ${approvalId} as ${nextStatus}.`);
    });
  }

  async function useApprovalCommand(positionals, options = {}) {
    const [approvalId] = positionals;
    const actingAgent = typeof options.by === 'string' && options.by.trim() ? options.by.trim() : '';
    const noteText = typeof options.note === 'string' ? options.note.trim() : '';
    if (!approvalId || !actingAgent) {
      throw new Error('Usage: approvals use <approval-id> --by <agent> [--note <text>]');
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getAgent(board, actingAgent);
      const approval = getApprovals(board).find((entry) => entry.id === approvalId);
      if (!approval) throw new Error(`Unknown approval "${approvalId}".`);
      if (approval.status !== 'approved') throw new Error(`Approval "${approvalId}" must be approved before it can be used.`);

      const timestamp = nowIso();
      approval.status = 'used';
      approval.usedBy = actingAgent;
      approval.usedAt = timestamp;
      approval.useNote = noteText || null;
      approval.updatedAt = timestamp;

      const task = approval.taskId ? ensureTask(board, approval.taskId) : null;
      if (task) {
        task.updatedAt = timestamp;
        note(task, actingAgent, 'approval-used', `Used approval ${approvalId} for ${approval.scope}.${noteText ? ` ${noteText}` : ''}`);
      }

      appendJournalLine(`- ${timestamp} | ${actingAgent} used approval \`${approvalId}\`${noteText ? `: ${noteText}` : ''}`);
      await saveBoard(board);
      console.log(`Marked approval ${approvalId} as used.`);
    });
  }

  async function approvalsCommand(positionals, options = {}) {
    const [subcommand = 'list', ...rest] = positionals;
    if (subcommand === 'list') {
      listApprovalsCommand(rest, options);
      return;
    }
    if (subcommand === 'check') {
      const status = checkApprovalCommand(rest, options);
      if (status !== 0) process.exitCode = status;
      return;
    }
    if (subcommand === 'request') return requestApprovalCommand(rest);
    if (subcommand === 'grant') return resolveApprovalCommand(rest, 'approved', options);
    if (subcommand === 'deny') return resolveApprovalCommand(rest, 'denied', options);
    if (subcommand === 'use') return useApprovalCommand(rest, options);
    throw new Error('Usage: approvals list|check|request|grant|deny|use [options]');
  }

  function hasApprovedTaskApproval(board, taskId, scope = '') {
    return Boolean(activeApprovalForTask(board, taskId, scope ? normalizeScope(scope, slugify) : ''));
  }

  return {
    approvalsCommand,
    hasApprovedTaskApproval,
  };
}
