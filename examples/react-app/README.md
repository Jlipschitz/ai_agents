# React App Example

This example is for a frontend app with source, UI tests, and optional visual checks.

Useful first commands:

```bash
npm run agents:doctor
npm run agents -- start agent-1 task-ui --paths src/components "Update the UI"
npm run agents -- run-check visual:test
```

The config treats `src/components`, `src/pages`, and `tests/visual` as high-signal paths for visual work.
