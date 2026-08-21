const crypto = require('crypto');

/**
 * Browser-harness adapter for the actual Worker source.
 *
 * The quote parser/builder live inside the Cloudflare Worker entry module and
 * are intentionally not public production exports.  The QA harness still
 * needs to execute those exact functions, not a second mock that can drift.
 * This build-only loader makes the two functions visible and replaces the one
 * Cloudflare-only base-class import with an inert class.  It does not copy or
 * reimplement any quote logic.
 */
module.exports = function workerQuoteCoreLoader(source) {
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  const transformed = source.replace(
    /import\s+\{\s*WorkflowEntrypoint\s*\}\s+from\s+['"]cloudflare:workers['"];?/,
    'const WorkflowEntrypoint = class {};',
  );

  if (transformed === source) {
    throw new Error('QA harness could not isolate the Cloudflare Workflow import.');
  }
  if (!/function\s+parseMessage\s*\(/.test(transformed)
      || !/function\s+buildQuoteResponse\s*\(/.test(transformed)
      || !/async\s+function\s+buildOneshotIntake\s*\(/.test(transformed)
      || !/function\s+attachTrustedQuoteOptionContracts\s*\(/.test(transformed)
      || !/function\s+validateExplicitMxMsQuoteComposition\s*\(/.test(transformed)) {
    throw new Error('QA harness could not find the Worker intake/parser/builder/contract/endpoint guard.');
  }

  return `${transformed}\n
export { attachTrustedQuoteOptionContracts, buildOneshotIntake, parseMessage, buildQuoteResponse, validateExplicitMxMsQuoteComposition };
export const HARNESS_WORKER_SOURCE_SHA256 = '${hash}';
`;
};
