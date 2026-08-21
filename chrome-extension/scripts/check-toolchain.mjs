#!/usr/bin/env node

const REQUIRED_NODE = 'v24.19.0';
const REQUIRED_PNPM = '11.19.0';

function fail(message) {
  console.error(`toolchain check failed: ${message}`);
  process.exit(1);
}

if (process.version !== REQUIRED_NODE) {
  fail(`expected Node ${REQUIRED_NODE.slice(1)}, received ${process.version.slice(1)}`);
}

const userAgent = process.env.npm_config_user_agent || '';
const pnpmMatch = userAgent.match(/(?:^|\s)pnpm\/([^\s]+)/);
if (!pnpmMatch || pnpmMatch[1] !== REQUIRED_PNPM) {
  fail(`builds must run through pnpm ${REQUIRED_PNPM}; received ${pnpmMatch ? pnpmMatch[1] : 'unknown package manager'}`);
}

console.log(`toolchain ok: Node ${REQUIRED_NODE.slice(1)}, pnpm ${REQUIRED_PNPM}`);
