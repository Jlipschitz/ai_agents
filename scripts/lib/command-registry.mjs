import { COMMANDS } from './help-command.mjs';

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
  return Object.keys(COMMANDS).sort((left, right) => left.localeCompare(right)).map((name) => ({
    name,
    usage: commandUsage(name),
    summary: commandSummary(name),
    json: commandUsage(name).includes('--json'),
    apply: commandUsage(name).includes('--apply'),
    dryRun: commandUsage(name).includes('--dry-run'),
  }));
}

export function commandNames() {
  return commandRegistryEntries().map((entry) => entry.name);
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
    const usageToken = primaryToken(entry.usage);
    if (usageToken && usageToken !== entry.name) warnings.push(`Usage token for ${entry.name} starts with ${usageToken}.`);
  }
  return { ok: errors.length === 0, errors, warnings, commands: commandRegistryEntries() };
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
  const known = new Set(commandNames());
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

  return {
    ok: errors.length === 0,
    commandCount: known.size,
    checkedScripts,
    errors,
    warnings,
  };
}
