import { createHeartbeatCommands } from './heartbeat-commands.mjs';
import { createWatchCommands } from './watch-commands.mjs';

export function createHeartbeatWatchCommands(context) {
  return {
    ...createHeartbeatCommands(context),
    ...createWatchCommands(context),
  };
}
