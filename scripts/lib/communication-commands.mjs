import fs from 'node:fs';
import path from 'node:path';

import { ensureDirectory, fileExists, nowIso } from './file-utils.mjs';

function sanitizeAppNoteText(value) {
  return String(value ?? '')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAppNotePaths(paths) {
  return paths.length ? paths.map((entry) => `\`${sanitizeAppNoteText(entry)}\``).join(', ') : 'none';
}

function getAppNotesSectionHeading(appNotesSectionHeading) {
  return `## ${appNotesSectionHeading}`;
}

function ensureAppNotesSection(content, appNotesSectionHeading) {
  const normalizedContent = content.trimEnd();
  const heading = getAppNotesSectionHeading(appNotesSectionHeading);

  if (normalizedContent.includes(heading)) {
    return normalizedContent;
  }

  return `${normalizedContent}\n\n${heading}\n\nAgents append durable discoveries here when they find errors, inconsistencies, gotchas, decisions, or behavior changes that should survive beyond one task.\n`;
}

function formatAppNoteEntry(entry) {
  const parts = [
    `- ${entry.timestamp}`,
    `agent: \`${sanitizeAppNoteText(entry.agentId)}\``,
    `category: \`${sanitizeAppNoteText(entry.category)}\``,
  ];

  if (entry.taskId) {
    parts.push(`task: \`${sanitizeAppNoteText(entry.taskId)}\``);
  }

  parts.push(`paths: ${formatAppNotePaths(entry.paths)}`);
  parts.push(sanitizeAppNoteText(entry.body));

  return parts.join(' | ');
}

export function createCommunicationCommands(context) {
  const {
    appAgentNotesDoc,
    appNoteCategories,
    appNotesSectionHeading,
    appendJournalLine,
    appendMessage,
    assertAgentSessionAvailable,
    ensureTask,
    getAgent,
    getBoard,
    getCommandAgent,
    getCurrentCommandName,
    getReadOnlyBoard,
    getTask,
    note,
    parsePathsOption,
    projectName,
    readMessages,
    root,
    saveBoard,
    withMutationLock,
    writeTextAtomicSync,
  } = context;

  function appendAppNoteEntry(entry) {
    if (!appAgentNotesDoc) {
      throw new Error('App notes document is not configured.');
    }

    const appNotesPath = path.join(root, appAgentNotesDoc);
    ensureDirectory(path.dirname(appNotesPath));

    const initialContent = fileExists(appNotesPath)
      ? fs.readFileSync(appNotesPath, 'utf8')
      : `# ${projectName} AI Agent App Notes\n\nUse this as the compact handoff document for agents working in this repository.\n`;
    const contentWithSection = ensureAppNotesSection(initialContent, appNotesSectionHeading);
    writeTextAtomicSync(appNotesPath, `${contentWithSection}\n${formatAppNoteEntry(entry)}\n`);
  }

  async function messageCommand(positionals, options) {
    const [fromAgent, toAgent, ...bodyParts] = positionals;
    const body = bodyParts.join(' ').trim();

    if (!fromAgent || !toAgent || !body) {
      throw new Error('Usage: message <from-agent> <to-agent|all> <message> [--task <task-id>]');
    }

    if (toAgent !== 'all') {
      getAgent(getBoard(), toAgent);
    }

    assertAgentSessionAvailable(fromAgent);
    getAgent(getBoard(), fromAgent);

    await withMutationLock(async () => {
      const timestamp = nowIso();
      const message = {
        at: timestamp,
        from: fromAgent,
        to: toAgent,
        taskId: typeof options.task === 'string' ? options.task : null,
        body,
      };

      appendMessage(message);
      appendJournalLine(`- ${timestamp} | message ${fromAgent} -> ${toAgent}${message.taskId ? ` on \`${message.taskId}\`` : ''}: ${body}`);

      if (message.taskId) {
        const board = getBoard();
        const task = getTask(board, message.taskId);

        if (task) {
          task.updatedAt = timestamp;
          note(task, fromAgent, 'message', body, { to: toAgent });
          await saveBoard(board);
        }
      }

      console.log(`Message logged from ${fromAgent} to ${toAgent}.`);
    });
  }

  async function appNoteCommand(positionals, options) {
    const [agentId, rawCategory, ...bodyParts] = positionals;
    const category = String(rawCategory ?? '').trim().toLowerCase();
    const body = bodyParts.join(' ').trim();
    const paths = parsePathsOption(options.paths ?? options.path);
    const taskId = typeof options.task === 'string' && options.task.trim() ? options.task.trim() : null;

    if (!agentId || !category || !body) {
      throw new Error(`Usage: app-note <agent> <${[...appNoteCategories].join('|')}> <note> [--task <task-id>] [--paths <path[,path...]>]`);
    }

    if (!appNoteCategories.has(category)) {
      throw new Error(`Unknown app-note category "${category}". Expected one of: ${[...appNoteCategories].join(', ')}.`);
    }

    await withMutationLock(async () => {
      const board = getBoard();
      getCommandAgent(board, agentId);
      const timestamp = nowIso();

      if (taskId) {
        const task = ensureTask(board, taskId);
        task.updatedAt = timestamp;
        note(task, agentId, 'app-note', body, { category, paths });
      }

      appendAppNoteEntry({
        timestamp,
        agentId,
        category,
        taskId,
        paths,
        body,
      });
      appendJournalLine(
        `- ${timestamp} | ${agentId} recorded app note (${category})${taskId ? ` for \`${taskId}\`` : ''}${paths.length ? ` on ${paths.join(', ')}` : ''}: ${body}`
      );

      if (taskId) {
        await saveBoard(board);
      }

      console.log(`Recorded app note in ${appAgentNotesDoc}.`);
    });
  }

  function inboxCommand(positionals, options) {
    const [agentId] = positionals;
    const limit = Number.parseInt(String(options.limit ?? '10'), 10);

    if (!agentId) {
      throw new Error('Usage: inbox <agent> [--limit <count>]');
    }

    assertAgentSessionAvailable(agentId, getCurrentCommandName(), { cleanupStale: false });
    getAgent(getReadOnlyBoard(), agentId);

    const messages = readMessages()
      .filter((message) => message.to === 'all' || message.to === agentId || message.from === agentId)
      .slice(-Math.max(limit, 1));

    if (!messages.length) {
      console.log(`No messages for ${agentId}.`);
      return;
    }

    console.log(
      messages
        .map((message) => `- ${message.at} | ${message.from} -> ${message.to}${message.taskId ? ` [${message.taskId}]` : ''}: ${message.body}`)
        .join('\n')
    );
  }

  return {
    appNoteCommand,
    inboxCommand,
    messageCommand,
  };
}
