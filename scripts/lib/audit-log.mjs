import fs from 'node:fs';
import path from 'node:path';

import { nowIso } from './file-utils.mjs';

export function auditLogPath(paths) {
  return path.join(paths.runtimeRoot, 'audit.ndjson');
}

export function appendAuditLog(paths, entry) {
  fs.mkdirSync(paths.runtimeRoot, { recursive: true });
  const payload = {
    at: nowIso(),
    command: entry.command,
    applied: Boolean(entry.applied),
    summary: entry.summary || '',
    details: entry.details || {},
  };
  fs.appendFileSync(auditLogPath(paths), `${JSON.stringify(payload)}\n`);
  return auditLogPath(paths);
}
