import { nowIso } from './file-utils.mjs';
import {
  applyTaskMetadata,
  formatTaskDueAt,
  formatTaskMetadataChanges,
  hasTaskMetadataOptions,
  taskMetadataFromOptions,
} from './task-metadata.mjs';

export function createTaskMetadataCommands(context) {
  const {
    appendJournalLine,
    ensureTask,
    getAgent,
    getBoard,
    note,
    saveBoard,
    withMutationLock,
  } = context;

  async function prioritizeCommand(positionals, options) {
    const [taskId] = positionals;
    const actor = typeof options.by === 'string' && options.by.trim() ? options.by.trim() : 'coordinator';
    const json = options.json === true || String(options.json ?? '').toLowerCase() === 'true';
    const dryRun = options['dry-run'] === true || String(options['dry-run'] ?? '').toLowerCase() === 'true';

    if (!taskId || !hasTaskMetadataOptions(options)) {
      throw new Error('Usage: prioritize <task-id> [--priority low|normal|high|urgent] [--due-at <iso|YYYY-MM-DD|none>] [--severity none|low|medium|high|critical] [--by <agent>]');
    }

    const metadata = taskMetadataFromOptions(options);
    const update = async ({ apply }) => {
      const board = getBoard();
      const task = ensureTask(board, taskId);
      if (actor !== 'coordinator') getAgent(board, actor);

      const before = { priority: task.priority, dueAt: task.dueAt, severity: task.severity };
      const changes = applyTaskMetadata(task, metadata);
      const after = { priority: task.priority, dueAt: task.dueAt, severity: task.severity };

      if (!changes.length) {
        const result = { ok: true, applied: false, taskId, before, after, changes: [] };
        if (json) console.log(JSON.stringify(result, null, 2));
        else console.log(`No metadata changes for ${taskId}.`);
        return null;
      }

      const timestamp = nowIso();
      const summary = formatTaskMetadataChanges(changes);
      task.updatedAt = timestamp;
      if (apply) {
        note(task, actor, 'metadata', `Updated metadata: ${summary}`);
        appendJournalLine(`- ${timestamp} | ${actor} updated metadata for \`${taskId}\`: ${summary}`);
        await saveBoard(board);
      }

      const result = { ok: true, applied: apply, taskId, before, after, changes };
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(apply ? `Updated ${taskId} metadata.` : `Dry run: would update ${taskId} metadata.`);
        console.log(`Priority: ${task.priority}`);
        console.log(`Due: ${formatTaskDueAt(task.dueAt)}`);
        console.log(`Severity: ${task.severity}`);
      }
      return apply ? result : null;
    };

    if (dryRun) {
      await update({ apply: false });
      return;
    }

    await withMutationLock(() => update({ apply: true }));
  }

  return { prioritizeCommand };
}
