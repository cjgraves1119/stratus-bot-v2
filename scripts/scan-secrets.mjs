#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedSegments = new Set([
  '.git',
  '.wrangler',
  'dist',
  'harness-dist',
  'node_modules',
  'release',
]);
const allowedFixturePaths = [
  /^data\/pricing\//,
  /classifier-fixtures\.json$/,
  /^worker-gchat\/test-license-key-matching\.js$/,
];
const binaryExtensions = /\.(?:avif|bmp|crx|gif|ico|jpe?g|pdf|png|webp|woff2?|zip)$/i;
const forbiddenSecretFile = /^(?:\.env(?:\..+)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|.*\.(?:key|pem|p12|pfx))$/i;

const detectors = [
  ['private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\r\n]+[A-Za-z0-9+/=\r\n]{40,}-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['cloudflare-token', /\bcfut_[A-Za-z0-9]{50,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ['stripe-live-secret', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g],
  ['sendgrid-key', /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{20,}\b/g],
  ['npm-token', /\bnpm_[0-9A-Za-z]{36}\b/g],
  ['openai-key', /\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}\b/g],
  ['jwt', /\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/g],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi],
  ['bearer-token', /\bAuthorization\s*[:=]\s*["'`]?Bearer\s+[0-9A-Za-z._~+\/-]{20,}/gi],
];
const assignment = /(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret)["']?\s*[:=]\s*(["'`])([^"'`\r\n]{8,})\1/gi;
const safeValue = /^(?:example|fake|dummy|placeholder|redacted|synthetic|test|your_|none|null|undefined|process\.env|import\.meta\.env|\$\{|<|\[)/i;

function repoPath(path) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function hasExcludedSegment(path) {
  return path.split('/').some((segment) => excludedSegments.has(segment));
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

const candidates = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b, 'en'));

const findings = [];
let scannedFiles = 0;
for (const candidate of candidates) {
  if (hasExcludedSegment(candidate) || allowedFixturePaths.some((pattern) => pattern.test(candidate))) continue;
  const absolutePath = resolve(repositoryRoot, candidate);
  if (!existsSync(absolutePath)) continue;
  const stats = lstatSync(absolutePath);
  if (!stats.isFile() || stats.size > 10 * 1024 * 1024 || binaryExtensions.test(candidate)) continue;
  if (candidate !== '.env.example' && forbiddenSecretFile.test(basename(candidate))) {
    findings.push({ detector: 'secret-file-name', path: candidate, line: 1 });
    continue;
  }

  const bytes = readFileSync(absolutePath);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  scannedFiles += 1;
  for (const [detector, pattern] of detectors) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (detector === 'url-credentials' && /example|localhost|user:pass|username:password/i.test(match[0])) {
        continue;
      }
      findings.push({ detector, path: candidate, line: lineNumber(text, match.index) });
    }
  }
  assignment.lastIndex = 0;
  for (const match of text.matchAll(assignment)) {
    const value = match[2].trim();
    const looksGenerated = value.length >= 16 && shannonEntropy(value) >= 3.8;
    if (
      looksGenerated
      && !safeValue.test(value)
      && !/process\.env|import\.meta\.env|secrets\.|\$\{/i.test(value)
    ) {
      findings.push({ detector: 'secret-assignment', path: candidate, line: lineNumber(text, match.index) });
    }
  }
}

const uniqueFindings = [...new Map(
  findings.map((finding) => [`${finding.detector}\0${finding.path}\0${finding.line}`, finding]),
).values()];
for (const finding of uniqueFindings) {
  console.error(`${finding.path}:${finding.line}: ${finding.detector}`);
}
if (uniqueFindings.length) {
  console.error(`secret scan failed: ${uniqueFindings.length} finding(s); matched values were intentionally suppressed`);
  process.exit(1);
}
console.log(`secret scan passed: ${scannedFiles} text files, ${candidates.length} tracked/unignored candidates, 0 findings`);
