# Docs-Only Example

This example is for a documentation repository where most work lands in `docs` and verification is a prose review.

Useful first commands:

```bash
npm run agents:doctor
npm run agents -- start agent-1 task-guide --paths docs "Draft the guide"
npm run agents -- finish agent-1 task-guide --require-doc-review "Guide ready"
```

The config routes planning toward docs scopes and keeps code checks lightweight.
