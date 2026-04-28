# Contributing

This repository is a portable coordination toolkit for multi-agent coding work. Keep changes small, explicit, and covered by focused tests.

## Local Setup

Use Node 24 or newer.

```bash
npm ci
npm run check
npm test
```

## Development Flow

1. Create or pick a task in the coordination board.
2. Keep changes scoped to the task.
3. Add or update tests for command behavior, mutation safety, and docs-visible workflows.
4. Run focused tests for the changed area.
5. Run the full validation set before committing:

```bash
npm run check
npm test
```

For formatting-only changes, use:

```bash
npm run format:check
npm run format
```

## Command Expectations

- Read-only commands must not mutate board, journal, messages, runtime files, or task docs.
- Apply-style commands should be dry-run by default unless they are legacy lifecycle commands.
- Multi-file mutations should use transactions and write an audit entry when they change coordination state.
- New commands should be added to help, completions, bootstrap scripts, package scripts, docs, and read-only mutation guard tests when relevant.

## Pull Request Checklist

- Focused tests pass.
- `npm run check` passes.
- `npm test` passes.
- Documentation reflects new command behavior or state-file changes.
- Secrets are not present in committed files; use `npm run agents -- secrets-scan --staged --strict` before publishing.
