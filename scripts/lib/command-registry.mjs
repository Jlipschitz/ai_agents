import { COMMANDS, commandHelpMetadata } from './help-command.mjs';

const BASE_COORDINATOR_COMMANDS = new Set([
  'node ./scripts/agent-coordination.mjs',
  'node ./scripts/agent-coordination-two.mjs',
  'ai-agents',
]);

function commandUsage(name) {
  return COMMANDS[name]?.[0] ?? '';
}

function commandSummary(name) {
  return COMMANDS[name]?.[1] ?? '';
}

function primaryToken(usage) {
  return String(usage).trim().split(/\s+/)[0] ?? '';
}

export function commandRegistryEntries() {
  return Object.keys(COMMANDS).sort((left, right) => left.localeCompare(right)).map((name) => {
    const usage = commandUsage(name);
    return {
      name,
      usage,
      summary: commandSummary(name),
      json: usage.includes('--json'),
      apply: usage.includes('--apply'),
      dryRun: usage.includes('--dry-run'),
      ...commandHelpMetadata(name),
    };
  });
}

export function commandNames() {
  return commandRegistryEntries().map((entry) => entry.name);
}

export function jsonCommandNames() {
  return commandRegistryEntries().filter((entry) => entry.json).map((entry) => entry.name);
}

export function commandRegistryMap() {
  return new Map(commandRegistryEntries().map((entry) => [entry.name, entry]));
}

export function findCommandMetadata(commandName) {
  return commandRegistryMap().get(commandName) ?? null;
}

export function validateCommandRegistry() {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (const entry of commandRegistryEntries()) {
    if (seen.has(entry.name)) errors.push(`Duplicate command registry entry: ${entry.name}`);
    seen.add(entry.name);
    if (!entry.usage) errors.push(`Missing usage for command: ${entry.name}`);
    if (!entry.summary) errors.push(`Missing summary for command: ${entry.name}`);
    if (!entry.group) errors.push(`Missing group metadata for command: ${entry.name}`);
    if (typeof entry.minimal !== 'boolean') errors.push(`Missing minimal metadata for command: ${entry.name}`);
    const usageToken = primaryToken(entry.usage);
    if (usageToken && usageToken !== entry.name) warnings.push(`Usage token for ${entry.name} starts with ${usageToken}.`);
  }
  return { ok: errors.length === 0, errors, warnings, commands: commandRegistryEntries() };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))].sort((left, right) => left.localeCompare(right));
}

function summarizeRegistry(commands) {
  const groups = {};
  for (const entry of commands) {
    groups[entry.group] ??= { commands: 0, minimalCommands: 0, jsonCommands: 0, commandNames: [], minimalCommandNames: [], jsonCommandNames: [] };
    groups[entry.group].commands += 1;
    groups[entry.group].commandNames.push(entry.name);
    if (entry.minimal) {
      groups[entry.group].minimalCommands += 1;
      groups[entry.group].minimalCommandNames.push(entry.name);
    }
    if (entry.json) {
      groups[entry.group].jsonCommands += 1;
      groups[entry.group].jsonCommandNames.push(entry.name);
    }
  }

  return {
    commandCount: commands.length,
    minimalCommandCount: commands.filter((entry) => entry.minimal).length,
    minimalCommands: commands.filter((entry) => entry.minimal).map((entry) => entry.name),
    jsonCommandCount: commands.filter((entry) => entry.json).length,
    jsonCommands: commands.filter((entry) => entry.json).map((entry) => entry.name),
    groups: Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)).map(([group, summary]) => [group, {
      ...summary,
      commandNames: uniqueSorted(summary.commandNames),
      minimalCommandNames: uniqueSorted(summary.minimalCommandNames),
      jsonCommandNames: uniqueSorted(summary.jsonCommandNames),
    }])),
  };
}

function tokenizeScript(script) {
  return String(script ?? '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, '')) ?? [];
}

export function commandFromPackageScript(script) {
  const tokens = tokenizeScript(script);
  if (!tokens.length) return null;
  const joined = tokens.join(' ');
  if (BASE_COORDINATOR_COMMANDS.has(joined)) return null;

  const coordinatorIndex = tokens.findIndex((token) => /(?:^|[/\\])agent-coordination(?:-two)?\.mjs$/.test(token) || token === 'ai-agents');
  if (coordinatorIndex < 0) return null;
  const command = tokens[coordinatorIndex + 1];
  return command && !command.startsWith('-') ? command : null;
}

export function validateCommandWiring({ packageJson = null, expectedScripts = null } = {}) {
  const registry = validateCommandRegistry();
  const commands = registry.commands;
  const known = new Set(commands.map((entry) => entry.name));
  const errors = [...registry.errors];
  const warnings = [...registry.warnings];
  const checkedScripts = [];

  for (const [source, scripts] of [
    ['package.json', packageJson?.scripts],
    ['expected package scripts', expectedScripts],
  ]) {
    if (!scripts || typeof scripts !== 'object') continue;
    for (const [name, script] of Object.entries(scripts)) {
      if (!name.startsWith('agents') && name !== 'ai-agents' && name !== 'format' && name !== 'format:check') continue;
      const command = commandFromPackageScript(script);
      if (!command) continue;
      checkedScripts.push({ source, name, command });
      if (!known.has(command)) errors.push(`${source} script "${name}" maps to unknown command "${command}".`);
    }
  }

  const shortcutCommands = uniqueSorted(checkedScripts.map((entry) => entry.command));
  const shortcutCommandSet = new Set(shortcutCommands);
  const minimalCommands = commands.filter((entry) => entry.minimal).map((entry) => entry.name);

  return {
    ok: errors.length === 0,
    commandCount: known.size,
    registry: summarizeRegistry(commands),
    scriptCoverage: {
      shortcutCommandCount: shortcutCommands.length,
      commandsWithShortcuts: shortcutCommands,
      minimalCommandsWithShortcuts: minimalCommands.filter((name) => shortcutCommandSet.has(name)),
      minimalCommandsWithoutShortcuts: minimalCommands.filter((name) => !shortcutCommandSet.has(name)),
    },
    checkedScripts,
    errors,
    warnings,
  };
}
