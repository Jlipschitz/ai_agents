import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeTransactionRoot(tempRoot) {
  const root = tempRoot || path.join(os.tmpdir(), 'ai-agents-state-transactions');
  return path.join(root, `tx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function snapshotTarget(targetPath, backupPath) {
  if (!fs.existsSync(targetPath)) return { targetPath, backupPath, existed: false };
  fs.cpSync(targetPath, backupPath, { recursive: true, force: true });
  return { targetPath, backupPath, existed: true };
}

function restoreTarget(snapshot) {
  fs.rmSync(snapshot.targetPath, { recursive: true, force: true });
  if (!snapshot.existed) return;
  fs.mkdirSync(path.dirname(snapshot.targetPath), { recursive: true });
  fs.cpSync(snapshot.backupPath, snapshot.targetPath, { recursive: true, force: true });
}

export async function withStateTransaction(targets, work, options = {}) {
  const transactionRoot = makeTransactionRoot(options.tempRoot);
  fs.mkdirSync(transactionRoot, { recursive: true });
  const snapshots = targets.map((targetPath, index) => snapshotTarget(targetPath, path.join(transactionRoot, String(index))));

  try {
    const result = await work();
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    for (const snapshot of snapshots.reverse()) restoreTarget(snapshot);
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    throw error;
  }
}
