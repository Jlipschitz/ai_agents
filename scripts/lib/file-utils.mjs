import fs from 'node:fs';
import path from 'node:path';

export function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readJsonDetailed(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, value: null, error: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, value: null, error: error.message };
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function appendUniqueLines(filePath, lines) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => line === '' || !existing.has(line));
  if (missing.filter(Boolean).length === 0) return false;
  fs.writeFileSync(filePath, `${current.replace(/\s*$/, '')}\n${missing.join('\n')}\n`);
  return true;
}

export function ensureFile(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

export function nowIso() {
  return new Date().toISOString();
}

export function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function parseIsoMs(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function hoursSince(value) {
  const parsed = parseIsoMs(value);
  return parsed ? Math.max(0, (Date.now() - parsed) / 36e5) : null;
}

export function isPidAlive(pid) {
  const normalizedPid = Number.parseInt(String(pid ?? ''), 10);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) return null;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}
