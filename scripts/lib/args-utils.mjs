export function hasFlag(argv, flag) {
  return argv.includes(flag) || argv.some((entry) => entry.startsWith(`${flag}=`));
}

export function getFlagValue(argv, flag, fallback = '') {
  const index = argv.indexOf(flag);
  if (index >= 0) return String(argv[index + 1] ?? fallback);
  const prefix = `${flag}=`;
  const inline = argv.find((entry) => entry.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

export function getPositionals(argv, valuedFlags = new Set()) {
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) {
      positionals.push(entry);
      continue;
    }
    const flag = entry.includes('=') ? entry.slice(0, entry.indexOf('=')) : entry;
    if (!entry.includes('=') && valuedFlags.has(flag)) index += 1;
  }
  return positionals;
}

export function getNumberFlag(argv, flag, fallback) {
  const value = Number.parseInt(getFlagValue(argv, flag, ''), 10);
  return Number.isFinite(value) ? value : fallback;
}
