import path from 'node:path';

const VALUE_FLAGS = new Set(['--config', '--root', '--coordination-dir', '--coordination-root']);
const BOOLEAN_FLAGS = new Set(['--verbose', '--quiet', '--no-color']);

function readFlagValue(arg, args, index) {
  if (arg.includes('=')) return { value: arg.slice(arg.indexOf('=') + 1), nextIndex: index };
  return { value: args[index + 1] ?? '', nextIndex: index + 1 };
}

function resolveFrom(root, value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

export function applyGlobalFlags({
  argv = process.argv,
  defaultCoordinationDir,
  defaultCliEntrypoint,
  scriptPath,
  watchLoopScriptPath,
} = {}) {
  const args = argv.slice(2);
  const cleaned = [];
  const globals = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      cleaned.push(...args.slice(index));
      break;
    }

    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (VALUE_FLAGS.has(flag)) {
      const { value, nextIndex } = readFlagValue(arg, args, index);
      globals[flag.slice(2).replaceAll('-', '_')] = value;
      index = nextIndex;
      continue;
    }

    if (BOOLEAN_FLAGS.has(flag)) {
      globals[flag.slice(2).replaceAll('-', '_')] = true;
      continue;
    }

    cleaned.push(arg);
  }

  if (globals.root) {
    process.chdir(resolveFrom(process.cwd(), globals.root));
  }

  const root = process.cwd();
  if (globals.config) process.env.AGENT_COORDINATION_CONFIG = resolveFrom(root, globals.config);
  if (globals.coordination_root) {
    process.env.AGENT_COORDINATION_ROOT = resolveFrom(root, globals.coordination_root);
    delete process.env.AGENT_COORDINATION_DIR;
  } else if (globals.coordination_dir) {
    process.env.AGENT_COORDINATION_DIR = globals.coordination_dir;
    delete process.env.AGENT_COORDINATION_ROOT;
  } else if (!process.env.AGENT_COORDINATION_ROOT && !process.env.AGENT_COORDINATION_DIR && defaultCoordinationDir) {
    process.env.AGENT_COORDINATION_DIR = defaultCoordinationDir;
  }

  if (globals.verbose) process.env.AGENT_COORDINATION_VERBOSE = '1';
  if (globals.quiet) process.env.AGENT_COORDINATION_QUIET = '1';
  if (globals.no_color) process.env.NO_COLOR = '1';
  if (!process.env.AGENT_COORDINATION_CLI_ENTRYPOINT && defaultCliEntrypoint) process.env.AGENT_COORDINATION_CLI_ENTRYPOINT = defaultCliEntrypoint;
  if (!process.env.AGENT_COORDINATION_SCRIPT && scriptPath) process.env.AGENT_COORDINATION_SCRIPT = scriptPath;
  if (!process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT && watchLoopScriptPath) process.env.AGENT_COORDINATION_WATCH_LOOP_SCRIPT = watchLoopScriptPath;

  process.argv = [argv[0], argv[1], ...cleaned];
  return { args: cleaned, globals };
}
