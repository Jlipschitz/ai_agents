import { COMMANDS } from './help-command.mjs';

export const BUILT_IN_COMMAND_ALIASES = new Map([
  ['s', ['status']],
  ['d', ['doctor']],
  ['p', ['plan']],
  ['sum', ['summarize']],
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function tokenizeAliasString(value) {
  const tokens = [];
  let current = '';
  let quote = '';
  let escaping = false;

  for (const char of String(value)) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

export function parseCommandAliasTokens(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
  if (typeof value === 'string') return tokenizeAliasString(value).filter(Boolean);
  return [];
}

export function configuredCommandAliases(config) {
  const aliases = config?.commandAliases;
  if (!isPlainObject(aliases)) return new Map();

  const result = new Map();
  for (const [name, value] of Object.entries(aliases)) {
    const aliasName = name.trim();
    const tokens = parseCommandAliasTokens(value);
    if (!aliasName || !tokens.length || BUILT_IN_COMMAND_ALIASES.has(aliasName) || Object.hasOwn(COMMANDS, aliasName)) continue;
    result.set(aliasName, tokens);
  }
  return result;
}

export function resolveCommandAlias(rawCommandName, commandArgs, config) {
  const builtIn = BUILT_IN_COMMAND_ALIASES.get(rawCommandName);
  const configured = configuredCommandAliases(config).get(rawCommandName);
  const aliasTokens = builtIn ?? configured;
  if (!aliasTokens) return { commandName: rawCommandName, commandArgs, aliasName: null };

  const [targetRaw, ...aliasArgs] = aliasTokens;
  const targetBuiltIn = BUILT_IN_COMMAND_ALIASES.get(targetRaw);
  const [commandName, ...targetAliasArgs] = targetBuiltIn ?? [targetRaw];
  return {
    commandName,
    commandArgs: [...targetAliasArgs, ...aliasArgs, ...commandArgs],
    aliasName: rawCommandName,
  };
}
