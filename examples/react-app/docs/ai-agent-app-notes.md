# React App Notes

## Runtime

- Node 24 or newer.
- Use the app's dev server for local UI review.
- Store visual artifacts under `test-results`.

## Coordination Notes

- Claims touching `src/components`, `src/pages`, or `src/styles` should run `visual:test`.
- Baseline updates should use `visual:update` and include artifact references in verification notes.
