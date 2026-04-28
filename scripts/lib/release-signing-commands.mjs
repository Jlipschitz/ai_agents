import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getFlagValue, hasFlag } from './args-utils.mjs';
import { printCommandError } from './error-formatting.mjs';
import { normalizePath, resolveRepoPath } from './path-utils.mjs';
import { withStateTransactionSync } from './state-transaction.mjs';

const MANIFEST_NAME = 'checksums.sha256';
const SIGNATURE_NAME = 'checksums.sha256.sig';
const SIGNATURE_HEADER = 'AI_AGENTS_SIGNATURE_V1';

function listFilesRecursive(root, relativeDir = '') {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = path.join(relativeDir, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) return listFilesRecursive(root, relativePath);
      return entry.isFile() ? [relativePath] : [];
    });
}

function releaseFiles(root) {
  return listFilesRecursive(root)
    .filter((relativePath) => relativePath !== MANIFEST_NAME && relativePath !== SIGNATURE_NAME)
    .sort((left, right) => left.localeCompare(right));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function buildChecksumManifest(root) {
  const files = releaseFiles(root);
  const entries = files.map((relativePath) => ({
    path: relativePath,
    sha256: sha256File(path.join(root, relativePath)),
  }));
  const manifest = `${entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`;
  return { entries, manifest };
}

function signingAlgorithmForKey(key) {
  return key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448' ? null : 'sha256';
}

function algorithmLabel(key) {
  return key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448' ? key.asymmetricKeyType : 'sha256';
}

export function signManifest(manifest, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const algorithm = signingAlgorithmForKey(key);
  const signature = crypto.sign(algorithm, Buffer.from(manifest), key);
  return {
    algorithm: algorithmLabel(key),
    signature: signature.toString('base64'),
  };
}

function renderSignatureFile(signature) {
  return [
    SIGNATURE_HEADER,
    `algorithm: ${signature.algorithm}`,
    `manifest: ${MANIFEST_NAME}`,
    `signature: ${signature.signature}`,
    '',
  ].join('\n');
}

function parseSignatureFile(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== SIGNATURE_HEADER) throw new Error('Signature file has an invalid header.');
  const fields = Object.fromEntries(lines.slice(1).map((line) => {
    const separator = line.indexOf(':');
    return separator >= 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : [line, ''];
  }));
  if (!fields.algorithm || !fields.signature) throw new Error('Signature file is missing algorithm or signature.');
  return fields;
}

function verifySignature(manifest, signatureFile, publicKeyPem) {
  const fields = parseSignatureFile(signatureFile);
  const key = crypto.createPublicKey(publicKeyPem);
  const algorithm = fields.algorithm === 'ed25519' || fields.algorithm === 'ed448' ? null : 'sha256';
  return crypto.verify(algorithm, Buffer.from(manifest), key, Buffer.from(fields.signature, 'base64'));
}

function parseManifest(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!match) throw new Error(`Invalid checksum manifest line: ${line}`);
      return { sha256: match[1].toLowerCase(), path: match[2] };
    });
}

export function verifyReleaseSignature(root, publicKeyPem = '') {
  const manifestPath = path.join(root, MANIFEST_NAME);
  const signaturePath = path.join(root, SIGNATURE_NAME);
  if (!fs.existsSync(manifestPath)) return { ok: false, findings: [`Missing ${MANIFEST_NAME}.`], entries: [], signature: null };
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const entries = parseManifest(manifest);
  const signedPaths = new Set(entries.map((entry) => entry.path));
  const findings = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.path);
    if (!fs.existsSync(filePath)) {
      findings.push(`Missing signed file: ${entry.path}`);
      continue;
    }
    const actual = sha256File(filePath);
    if (actual !== entry.sha256) findings.push(`Checksum mismatch for ${entry.path}.`);
  }
  for (const relativePath of releaseFiles(root)) {
    if (!signedPaths.has(relativePath)) findings.push(`Unsigned file in release directory: ${relativePath}`);
  }

  let signature = null;
  if (fs.existsSync(signaturePath)) {
    if (!publicKeyPem) findings.push('Signature exists but no public key was provided.');
    else {
      const verified = verifySignature(manifest, fs.readFileSync(signaturePath, 'utf8'), publicKeyPem);
      signature = { verified };
      if (!verified) findings.push('Signature verification failed.');
    }
  } else if (publicKeyPem) {
    findings.push(`Missing ${SIGNATURE_NAME}.`);
  }

  return { ok: findings.length === 0, findings, entries, signature };
}

export function buildReleaseSigningPlan(root, options = {}) {
  if (!fs.existsSync(root)) throw new Error(`Release directory not found: ${root}`);
  const { entries, manifest } = buildChecksumManifest(root);
  const signature = options.privateKeyPem ? signManifest(manifest, options.privateKeyPem) : null;
  return {
    ok: entries.length > 0,
    entries,
    manifest,
    signature,
    files: [
      { name: MANIFEST_NAME, path: path.join(root, MANIFEST_NAME), content: manifest },
      ...(signature ? [{ name: SIGNATURE_NAME, path: path.join(root, SIGNATURE_NAME), content: renderSignatureFile(signature) }] : []),
    ],
  };
}

export function writeReleaseSigningPlan(root, plan) {
  withStateTransactionSync([root], () => {
    for (const file of plan.files) fs.writeFileSync(file.path, file.content);
  });
}

function readOptionalKey(root, argv, flag) {
  const keyPath = getFlagValue(argv, flag, '');
  if (!keyPath) return '';
  return fs.readFileSync(resolveRepoPath(keyPath, keyPath, root), 'utf8');
}

function publicFile(file, root) {
  return { name: file.name, path: normalizePath(file.path, root) || file.path };
}

export function runReleaseSign(argv, context) {
  const json = hasFlag(argv, '--json');
  const verify = hasFlag(argv, '--verify');
  const apply = hasFlag(argv, '--apply');
  const dirValue = getFlagValue(argv, '--dir', '');
  if (!dirValue) return printCommandError('Usage: release-sign --dir <release-dir> [--private-key <path> --apply] [--verify --public-key <path>] [--json]', { json });
  const releaseRoot = resolveRepoPath(dirValue, dirValue, context.root);

  try {
    if (verify) {
      const verification = verifyReleaseSignature(releaseRoot, readOptionalKey(context.root, argv, '--public-key'));
      const result = { ok: verification.ok, releaseRoot: normalizePath(releaseRoot, context.root) || releaseRoot, verification };
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log('# Release Signature Verification');
        console.log(`Release: ${result.releaseRoot}`);
        console.log(verification.ok ? '- ok' : verification.findings.map((finding) => `- ${finding}`).join('\n'));
      }
      return verification.ok ? 0 : 1;
    }

    const privateKeyPem = readOptionalKey(context.root, argv, '--private-key');
    const plan = buildReleaseSigningPlan(releaseRoot, { privateKeyPem });
    if (apply) writeReleaseSigningPlan(releaseRoot, plan);
    const result = {
      ok: plan.ok,
      applied: apply,
      releaseRoot: normalizePath(releaseRoot, context.root) || releaseRoot,
      entries: plan.entries,
      signature: plan.signature ? { algorithm: plan.signature.algorithm } : null,
      files: plan.files.map((file) => publicFile(file, context.root)),
      warning: plan.signature ? null : 'No private key was provided; checksum manifest is unsigned.',
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log('# Release Signing');
      console.log(apply ? `Wrote signing files for ${result.releaseRoot}.` : `Dry run: would write signing files for ${result.releaseRoot}.`);
      console.log(result.files.map((file) => `- ${file.path}`).join('\n'));
      if (result.warning) console.log(`warning: ${result.warning}`);
    }
    return plan.ok ? 0 : 1;
  } catch (error) {
    return printCommandError(error.message, { json });
  }
}
