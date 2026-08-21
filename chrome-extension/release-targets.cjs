'use strict';

const PRODUCTION_API_BASE = 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev';
const PRODUCTION_UPDATE_URL = 'https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml';

// This list is deliberately empty until the team DEV gateway has been reviewed.
// Adding an origin is a release-architecture change and must be code reviewed.
const APPROVED_TEAM_DEV_API_BASES = Object.freeze([]);

const TARGET_NAMES = Object.freeze(['prod', 'snapshot-dev', 'team-dev']);

function normalizeApiBase(value, label = 'API base') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or a fragment`);
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`${label} must be an origin with no path`);
  }
  if (!parsed.hostname.endsWith('.workers.dev')) {
    throw new Error(`${label} must be a reviewed Cloudflare Workers origin`);
  }

  return parsed.origin;
}

function resolveBuildTarget(targetName, options = {}) {
  const environment = options.environment || process.env;
  const approvedTeamDevApiBases = options.approvedTeamDevApiBases || APPROVED_TEAM_DEV_API_BASES;

  if (!TARGET_NAMES.includes(targetName)) {
    throw new Error(`unknown build target "${targetName || ''}"; expected one of: ${TARGET_NAMES.join(', ')}`);
  }

  // These legacy switches could independently mix branding and gateways. Reject
  // them so one reviewed target always controls the entire build atomically.
  if (environment.STRATUS_API_BASE || environment.STRATUS_ENV) {
    throw new Error('STRATUS_API_BASE and STRATUS_ENV are unsupported; select one named build target instead');
  }

  if (targetName === 'prod') {
    return Object.freeze({
      name: 'prod',
      apiBase: PRODUCTION_API_BASE,
      stratusEnv: 'prod',
      manifestName: 'Stratus AI',
      actionTitle: 'Stratus AI',
      updateUrl: PRODUCTION_UPDATE_URL,
      releaseEligible: true,
    });
  }

  if (targetName === 'snapshot-dev') {
    return Object.freeze({
      name: 'snapshot-dev',
      apiBase: PRODUCTION_API_BASE,
      stratusEnv: 'dev',
      manifestName: 'Stratus AI (DEV)',
      actionTitle: 'Stratus AI (DEV)',
      updateUrl: null,
      releaseEligible: false,
    });
  }

  const requestedApiBase = normalizeApiBase(
    environment.STRATUS_TEAM_DEV_API_BASE,
    'STRATUS_TEAM_DEV_API_BASE',
  );
  if (requestedApiBase === PRODUCTION_API_BASE) {
    throw new Error('team-dev must not use the production API origin');
  }

  const approved = approvedTeamDevApiBases.map((value) => normalizeApiBase(value, 'approved team DEV API base'));
  if (!approved.includes(requestedApiBase)) {
    const blocker = approved.length
      ? `approved origins: ${approved.join(', ')}`
      : 'no team DEV origin has been approved in release-targets.cjs';
    throw new Error(`STRATUS_TEAM_DEV_API_BASE is not approved (${blocker})`);
  }

  return Object.freeze({
    name: 'team-dev',
    apiBase: requestedApiBase,
    stratusEnv: 'dev',
    manifestName: 'Stratus AI (TEAM DEV)',
    actionTitle: 'Stratus AI (TEAM DEV)',
    updateUrl: null,
    releaseEligible: false,
  });
}

function isStratusWorkerHostPermission(value) {
  if (typeof value !== 'string' || !value.endsWith('/*')) return false;
  try {
    const parsed = new URL(value.slice(0, -1));
    return parsed.hostname.startsWith('stratus-ai-bot-') && parsed.hostname.endsWith('.workers.dev');
  } catch {
    return false;
  }
}

function manifestForTarget(sourceManifest, profile) {
  const manifest = structuredClone(sourceManifest);
  manifest.name = profile.manifestName;
  manifest.action = { ...manifest.action, default_title: profile.actionTitle };

  let insertedWorkerHost = false;
  manifest.host_permissions = (manifest.host_permissions || []).flatMap((value) => {
    if (!isStratusWorkerHostPermission(value)) return [value];
    if (insertedWorkerHost) return [];
    insertedWorkerHost = true;
    return [`${profile.apiBase}/*`];
  });
  if (!insertedWorkerHost) manifest.host_permissions.push(`${profile.apiBase}/*`);

  if (profile.updateUrl) manifest.update_url = profile.updateUrl;
  else delete manifest.update_url;

  return manifest;
}

function renderManifestForTarget(sourceText, profile) {
  const sourceManifest = JSON.parse(sourceText);
  return `${JSON.stringify(manifestForTarget(sourceManifest, profile), null, 2)}\n`;
}

module.exports = {
  APPROVED_TEAM_DEV_API_BASES,
  PRODUCTION_API_BASE,
  PRODUCTION_UPDATE_URL,
  TARGET_NAMES,
  manifestForTarget,
  normalizeApiBase,
  renderManifestForTarget,
  resolveBuildTarget,
};
