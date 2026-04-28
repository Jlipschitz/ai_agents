import { createTaskClaimCommands } from './task-claim-commands.mjs';
import { createTaskFlowCommands } from './task-flow-commands.mjs';

export function createTaskLifecycleCommands(context) {
  return {
    ...createTaskClaimCommands(context),
    ...createTaskFlowCommands(context),
  };
}
