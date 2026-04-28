const DEFAULT_CAPACITY_POLICY = {
  maxActiveTasksPerAgent: 1,
  maxBlockedTasksPerAgent: 1,
  preferredDomainsByAgent: {},
  enforcePreferredDomains: false,
};

const DEFAULT_CONFLICT_POLICY = {
  enabled: true,
  blockOnGitOverlap: true,
};

function toInteger(value, fallback, min) {
  return Number.isInteger(value) && value >= min ? value : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function normalizePreferredDomains(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([agentId, domains]) => [agentId, [...new Set(stringArray(domains))]])
      .filter(([, domains]) => domains.length)
  );
}

export function normalizeClaimPolicies(config = {}) {
  const capacity = config.capacity && typeof config.capacity === 'object' ? config.capacity : {};
  const conflicts = config.conflictPrediction && typeof config.conflictPrediction === 'object' ? config.conflictPrediction : {};

  return {
    capacity: {
      maxActiveTasksPerAgent: toInteger(capacity.maxActiveTasksPerAgent, DEFAULT_CAPACITY_POLICY.maxActiveTasksPerAgent, 1),
      maxBlockedTasksPerAgent: toInteger(capacity.maxBlockedTasksPerAgent, DEFAULT_CAPACITY_POLICY.maxBlockedTasksPerAgent, 0),
      preferredDomainsByAgent: normalizePreferredDomains(capacity.preferredDomainsByAgent ?? capacity.preferredDomains),
      enforcePreferredDomains: capacity.enforcePreferredDomains === true,
    },
    conflicts: {
      enabled: conflicts.enabled !== false,
      blockOnGitOverlap: conflicts.blockOnGitOverlap !== false,
    },
  };
}

export function evaluateCapacityPolicy({ board, agentId, taskId, domains, policy, activeTaskStatuses }) {
  const errors = [];
  const warnings = [];
  const activeTasks = board.tasks.filter(
    (task) => task.id !== taskId && task.ownerId === agentId && activeTaskStatuses.has(task.status)
  );
  const blockedTasks = activeTasks.filter((task) => task.status === 'blocked');
  const preferredDomains = policy.preferredDomainsByAgent[agentId] ?? [];

  if (activeTasks.length >= policy.maxActiveTasksPerAgent) {
    errors.push(
      `${agentId} is already at the active task limit (${activeTasks.length}/${policy.maxActiveTasksPerAgent}): ${activeTasks.map((task) => task.id).join(', ')}.`
    );
  }

  if (blockedTasks.length > 0 && blockedTasks.length >= policy.maxBlockedTasksPerAgent) {
    errors.push(
      `${agentId} is already at the blocked task limit (${blockedTasks.length}/${policy.maxBlockedTasksPerAgent}): ${blockedTasks.map((task) => task.id).join(', ')}.`
    );
  }

  if (preferredDomains.length && domains.length && !domains.some((domain) => preferredDomains.includes(domain))) {
    const message = `${agentId} prefers domain(s) ${preferredDomains.join(', ')}, but this claim looks like ${domains.join(', ')}.`;
    if (policy.enforcePreferredDomains) errors.push(message);
    else warnings.push(message);
  }

  return { errors, warnings };
}

export function predictClaimConflicts({ board, agentId, taskId, claimedPaths, gitChangedPaths, policy, activeTaskStatuses, pathsOverlap }) {
  const errors = [];
  const warnings = [];

  if (!policy.enabled || !gitChangedPaths.available || !gitChangedPaths.paths.length) {
    return { errors, warnings };
  }

  for (const task of board.tasks) {
    if (!task.ownerId || task.ownerId === agentId || task.id === taskId || !activeTaskStatuses.has(task.status)) continue;

    for (const changedPath of gitChangedPaths.paths) {
      const overlap = task.claimedPaths.find((taskPath) => pathsOverlap(taskPath, changedPath));
      if (!overlap) continue;

      const message = `Local Git change "${changedPath}" overlaps active work ${task.ownerId}/${task.id} (${overlap}).`;
      if (policy.blockOnGitOverlap) errors.push(message);
      else warnings.push(message);
    }
  }

  const claimedDirtyPaths = gitChangedPaths.paths.filter((changedPath) => claimedPaths.some((claimedPath) => pathsOverlap(claimedPath, changedPath)));
  if (claimedDirtyPaths.length) {
    warnings.push(`Claim includes current local Git change(s): ${claimedDirtyPaths.join(', ')}.`);
  }

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
