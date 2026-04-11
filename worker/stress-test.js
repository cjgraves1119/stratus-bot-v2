#!/usr/bin/env node
/**
 * Comprehensive 3-tier waterfall stress test
 * Tests CF-first waterfall: CF classifies intent, deterministic executes quotes
 * Validates correct routing AND response quality
 */

const { execSync } = require('child_process');

const BASE_URL = 'https://stratus-ai-bot.chrisg-ec1.workers.dev/test-routing';

// ═══════════════════════════════════════════════════════════════
// TEST DEFINITIONS: 100+ prompts with expected layer + validation
// ═══════════════════════════════════════════════════════════════

const tests = [
  // ── CATEGORY 1: CF-Routed Deterministic Quotes (CF classifies as quote, deterministic executes) ──
  { input: 'quote 10 MR46', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR46') },
  { input: 'quote 5 MX75', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX75') },
  { input: '3 CW9164', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('CW9164') },
  { input: 'quote 1 MS390-24', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MS390') },
  { input: '2x MV72', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MV72') },
  { input: 'quote 1 MX67', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX67') },
  { input: '10 MR28 with 3 year license', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR28') },
  { input: 'quote 4 CW9166 5yr', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('CW9166') },
  { input: '1 MX450', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX450') },
  { input: 'quote 2 MS250-48FP', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MS250') },
  { input: '6 MR57 1yr enterprise', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR57') },
  { input: 'quote 1 Z4', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('Z4') },
  { input: '3 MV22 with 5 year license', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MV22') },
  { input: 'quote 1 MG51', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MG51') },
  { input: '20 MT14', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MT14') },

  // ── CATEGORY 2: Deterministic Multi-item Quotes ──
  { input: 'quote 5 MR46 and 2 MS225-24P', expect: 'cf-deterministic', category: 'det-multi', validate: r => r.includes('MR46') && r.includes('MS225') },
  { input: '3 CW9164 2 CW9166', expect: 'cf-deterministic', category: 'det-multi', validate: r => r.includes('CW9164') && r.includes('CW9166') },
  { input: '1 MX75 1 MS390-24 5 MR46', expect: 'cf-deterministic', category: 'det-multi', validate: r => r.includes('MX75') && r.includes('MR46') },

  // ── CATEGORY 3: Deterministic License-only Quotes ──
  { input: 'LIC-ENT-3YR', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-ENT') },
  { input: '5 MR licenses', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-ENT') },
  { input: 'quote 10 MV licenses 3 year', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-MV') },

  // ── CATEGORY 4: Deterministic Pricing (specific SKU + pricing keyword) ──
  { input: 'how much is a MR46', expect: 'deterministic-pricing', category: 'det-pricing', validate: r => r.includes('MR46') },
  { input: 'price of MX75-HW', expect: 'deterministic-pricing', category: 'det-pricing', validate: r => r.includes('MX75') },
  { input: 'cost of 3x CW9164I-MR', expect: 'deterministic-pricing', category: 'det-pricing', validate: r => r.includes('CW9164') },
  { input: 'what does a MS390-24 cost', expect: ['deterministic-pricing', 'cf-deterministic', 'claude'], category: 'det-pricing', validate: r => /MS390|price|cost|\$|Did you mean|product.?info|Claude/i.test(r) },

  // ── CATEGORY 5: Deterministic EOL Lookups ──
  { input: 'when is MR42 end of life', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'is the MR33 EOL', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'EOL date for MR18', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale|not recognized/i.test(r) },

  // ── CATEGORY 6: Deterministic Clarifications (Duo/Umbrella) ──
  { input: 'quote 10 Duo', expect: 'deterministic-clarify', category: 'det-clarify', validate: r => /tier|advantage|premier|essential/i.test(r) },
  { input: 'quote Umbrella', expect: 'deterministic-clarify', category: 'det-clarify', validate: r => /DNS|SIG|type|tier/i.test(r) },

  // ── CATEGORY 7: CF Clarify — bare product families (MUST NOT go to deterministic or Claude) ──
  { input: 'how much is a MX', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MX67|MX68|MX75|which|model/i.test(r) },
  { input: 'I need some switches', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MS|switch|which|model/i.test(r) },
  { input: 'quote me some APs', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|AP|access point|which|model/i.test(r) },
  { input: 'how much is a firewall', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MX|which|model|firewall/i.test(r) },
  { input: 'I need a camera', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MV|camera|which|model/i.test(r) },
  { input: 'price of a switch', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MS|switch|which|model/i.test(r) },
  { input: 'how much are meraki access points', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|which|model/i.test(r) },
  { input: 'quote a MR', expect: ['cf-clarify', 'claude'], category: 'cf-clarify', validate: r => /MR28|MR36|MR44|MR46|MR57|which|model|Claude/i.test(r) },
  { input: 'cost of an AP', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|which|model|access point/i.test(r) },
  { input: 'give me a quote on cameras', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MV|camera|which|model/i.test(r) },
  { input: 'how much for sensors', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MT|sensor|which|model/i.test(r) },
  { input: 'price on a Meraki', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /which|model|product|family|MR|MX|MS/i.test(r) },

  // ── CATEGORY 8: CF Product Info — sizing/recommendation questions ──
  { input: 'what firewall should I get for 50 users', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'which MX for 200 people', expect: ['claude', 'cf-clarify'], category: 'claude-prodinfo', validate: r => /product.?info|Claude|MX75|200/i.test(r) },
  { input: 'best AP for a warehouse', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what firewall for a school of 2000 students', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'recommend a switch for a small office', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what AP covers 5000 sq ft', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'which camera for outdoor parking lot', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'firewall for 500 employees', expect: ['claude', 'cf-clarify'], category: 'claude-prodinfo', validate: r => /product.?info|Claude|MX85|MX95|500/i.test(r) },
  { input: 'whats a good MX for a data center', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'I have a 10000 user campus what MX do I need', expect: ['claude', 'cf-clarify'], category: 'claude-prodinfo', validate: r => /product.?info|Claude|MX250|MX450|10.?000/i.test(r) },
  { input: 'WiFi 7 or WiFi 6 for a new office', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'whats the best AP for high density conference rooms', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },

  // ── CATEGORY 9: CF Conversation — greetings, banter, identity ──
  { input: 'hi', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'hello', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'hey there', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'thanks!', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'who are you', expect: 'cf-conversation', category: 'cf-convo', validate: r => /stratus|quoting|bot|assistant/i.test(r) },
  { input: 'what can you do', expect: ['cf-conversation', 'claude'], category: 'cf-convo', validate: r => /quote|pricing|product|help|Claude/i.test(r) },
  { input: 'goodbye', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'whats up', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'good morning', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'tell me a joke', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 10 },
  { input: 'lol', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },
  { input: 'nice', expect: 'cf-conversation', category: 'cf-convo', validate: r => r.length > 5 },

  // ── CATEGORY 10: Claude — complex product comparisons (should go to Claude) ──
  { input: 'compare the MR46, CW9164, and CW9166 for a university deployment', expect: 'claude', category: 'claude-compare', validate: () => true },
  { input: 'what are the detailed throughput specs of the MX85 vs MX95', expect: 'claude', category: 'claude-compare', validate: () => true },
  { input: 'write me a proposal for a full Meraki stack for a 3-building campus', expect: 'claude', category: 'claude-complex', validate: () => true },

  // ── CATEGORY 11: Edge Cases — ambiguous inputs that test boundary behavior ──
  { input: 'MX', expect: 'cf-clarify', category: 'edge-bare', validate: r => /MX67|MX68|which|model/i.test(r) },
  { input: 'MR', expect: 'cf-clarify', category: 'edge-bare', validate: r => /MR28|MR36|MR44|which|model/i.test(r) },
  { input: 'MS', expect: 'cf-clarify', category: 'edge-bare', validate: r => /MS120|MS130|which|model/i.test(r) },
  { input: 'firewall', expect: 'cf-clarify', category: 'edge-bare', validate: r => /MX|firewall|which|model|security/i.test(r) },
  { input: 'switch', expect: 'cf-clarify', category: 'edge-bare', validate: r => /MS|switch|which|model/i.test(r) },

  // ── CATEGORY 12: Edge Cases — typos and near-misses ──
  { input: 'quote 1 MR45', expect: 'cf-deterministic', category: 'edge-typo', validate: r => /MR44|MR46|not recognized|did you mean/i.test(r) },
  { input: 'quote 1 MX76', expect: 'cf-deterministic', category: 'edge-typo', validate: r => /MX75|not recognized|did you mean/i.test(r) },
  { input: 'quote 1 CW9165', expect: 'cf-deterministic', category: 'edge-typo', validate: r => /CW9164|CW9166|not recognized|did you mean/i.test(r) },

  // ── CATEGORY 13: Edge Cases — mixed intent (pricing question + vague product) ──
  { input: 'how much do MR access points cost', expect: 'cf-clarify', category: 'edge-mixed', validate: r => /MR28|MR36|MR44|MR46|which|model/i.test(r) },
  { input: 'pricing for meraki switches', expect: 'cf-clarify', category: 'edge-mixed', validate: r => /MS|switch|which|model/i.test(r) },
  { input: 'what is the price range for MX firewalls', expect: ['cf-clarify', 'claude'], category: 'edge-mixed', validate: r => /MX|which|range|model|firewall|Claude/i.test(r) },

  // ── CATEGORY 14: Edge Cases — product questions disguised as quotes ──
  { input: 'can I get a quote on whatever MX works for 100 people', expect: ['claude', 'cf-clarify'], category: 'edge-disguised', validate: r => /MX67|MX68|MX75|100|user|which|model|Claude/i.test(r) },
  { input: 'quote me the best switch for a 48 port closet', expect: ['claude', 'cf-clarify'], category: 'edge-disguised', validate: r => /MS|48.*port|switch|which|model/i.test(r) },

  // ── CATEGORY 15: EOL products quoted (should handle gracefully) ──
  { input: 'quote 5 MR42', expect: 'cf-deterministic', category: 'det-eol-quote', validate: r => /eol|end of|replacement|CW9164|MR46/i.test(r) },
  { input: 'quote 3 MR33', expect: 'cf-deterministic', category: 'det-eol-quote', validate: r => /eol|end of|replacement/i.test(r) },
  { input: 'quote 1 MX64', expect: 'cf-deterministic', category: 'det-eol-quote', validate: r => /eol|end of|replacement|MX67|MX68/i.test(r) },

  // ── CATEGORY 16: Natural language quotes (CF should extract and re-parse) ──
  { input: 'I need 10 of the MR46 access points with 3 year licensing please', expect: 'cf-deterministic', category: 'nl-quote', validate: r => /MR46/i.test(r) },
  { input: 'get me a quote for one MX85 firewall', expect: 'cf-deterministic', category: 'nl-quote', validate: r => /MX85/i.test(r) },
  { input: 'can you price out 4 of the CW9162 with 5 year licenses', expect: 'cf-deterministic', category: 'nl-quote', validate: r => /CW9162/i.test(r) },
  { input: 'I want to order 2 MS225-24P switches with 1 year license', expect: 'cf-deterministic', category: 'nl-quote', validate: r => /MS225/i.test(r) },

  // ── CATEGORY 17: Non-product questions (should stay in CF conversation or go to Claude) ──
  { input: 'what time is it', expect: 'cf-conversation', category: 'cf-offtopic', validate: r => r.length > 5 },
  { input: 'who is the CEO of Cisco', expect: ['cf-conversation', 'claude'], category: 'cf-offtopic', validate: r => r.length > 5 },
  { input: 'how do I reset a Meraki device', expect: 'claude', category: 'cf-support', validate: r => r.length > 10 },
  { input: 'whats the weather like', expect: 'cf-conversation', category: 'cf-offtopic', validate: r => r.length > 5 },

  // ── CATEGORY 18: Stress — extremely long/short/weird inputs ──
  { input: 'q', expect: 'cf-conversation', category: 'stress', validate: r => r.length > 5 },
  { input: '?', expect: 'cf-conversation', category: 'stress', validate: r => r.length > 5 },
  { input: 'quote', expect: 'cf-clarify', category: 'stress', validate: r => /what|which|help|quote/i.test(r) },
  { input: 'price', expect: 'cf-clarify', category: 'stress', validate: r => /what|which|help|product/i.test(r) },
  { input: 'I need a full network refresh for our 5 building campus with 200 APs 50 switches and 3 MX firewalls across multiple closets and I need pricing for all of it with 3 year licensing', expect: ['cf-deterministic', 'claude'], category: 'stress-long', validate: r => r.length > 10 },
  { input: '!!!', expect: 'cf-conversation', category: 'stress', validate: r => r.length > 3 },
  { input: '   ', expect: ['cf-conversation', 'cf-clarify'], category: 'stress', validate: r => r.length >= 0 },
  { input: 'MR46 MR46 MR46', expect: 'cf-deterministic', category: 'stress', validate: r => /MR46/i.test(r) },

  // ── CATEGORY 19: Deterministic — specific variant SKUs ──
  { input: 'quote 1 MS130-8P', expect: 'cf-deterministic', category: 'det-variant', validate: r => /MS130/i.test(r) },
  { input: 'quote 1 MS210-24P', expect: 'cf-deterministic', category: 'det-variant', validate: r => /MS210/i.test(r) },
  { input: 'quote 2 MX67W', expect: 'cf-deterministic', category: 'det-variant', validate: r => /MX67W/i.test(r) },
  { input: 'quote 1 CW9172I', expect: 'cf-deterministic', category: 'det-variant', validate: r => /CW9172/i.test(r) },
  { input: 'quote 1 MS390-48UX', expect: 'cf-deterministic', category: 'det-variant', validate: r => /MS390/i.test(r) },
  { input: 'quote 1 MR36H', expect: 'cf-deterministic', category: 'det-variant', validate: r => /MR36H/i.test(r) },

  // ── CATEGORY 20: Product info that should NOT become quotes (routes to Claude) ──
  { input: 'whats the difference between MR46 and MR57', expect: 'claude', category: 'prodinfo-noquote', validate: r => /product.?info|Claude|MR46|MR57|difference/i.test(r) },
  { input: 'does the MX67 support SD-WAN', expect: 'claude', category: 'prodinfo-noquote', validate: r => /product.?info|Claude|MX67|SD-?WAN/i.test(r) },
  { input: 'what PoE does the MS225-24P support', expect: 'claude', category: 'prodinfo-noquote', validate: r => /product.?info|Claude|MS225|PoE/i.test(r) },
  { input: 'is the MR44 still supported', expect: ['claude', 'deterministic-eol'], category: 'prodinfo-noquote', validate: r => /product.?info|Claude|MR44|support|eol|end/i.test(r) },

  // ═══════════════════════════════════════════════════════════════
  // ROUND 2: 55+ additional stress tests
  // ═══════════════════════════════════════════════════════════════

  // ── CATEGORY 21: CW model normalization (CW9164→CW9164I auto-suffix) ──
  { input: '3 CW9162', expect: 'cf-deterministic', category: 'cw-norm', validate: r => /CW9162I/i.test(r) },
  { input: 'quote 5 CW9166', expect: 'cf-deterministic', category: 'cw-norm', validate: r => /CW9166/i.test(r) },
  { input: '1 CW9172', expect: 'cf-deterministic', category: 'cw-norm', validate: r => /CW9172/i.test(r) },
  { input: 'quote 2 CW9164 and 3 CW9166', expect: 'cf-deterministic', category: 'cw-norm', validate: r => /CW9164I.*CW9166|CW9166.*CW9164I/i.test(r) },
  { input: 'quote 1 CW9164I', expect: 'cf-deterministic', category: 'cw-norm', validate: r => /CW9164I/i.test(r) },

  // ── CATEGORY 22: Pricing lookups via getPrice suffix fallback ──
  { input: 'how much is a MX67', expect: 'deterministic-pricing', category: 'price-suffix', validate: r => /MX67|\$/i.test(r) },
  { input: 'price of MR57', expect: 'deterministic-pricing', category: 'price-suffix', validate: r => /MR57|\$/i.test(r) },
  { input: 'cost of CW9164I-MR', expect: 'deterministic-pricing', category: 'price-suffix', validate: r => /CW9164|\$/i.test(r) },
  { input: 'how much is a MV72', expect: 'deterministic-pricing', category: 'price-suffix', validate: r => /MV72|\$/i.test(r) },

  // ── CATEGORY 23: License-only quotes (various patterns) ──
  { input: 'MR44 license', expect: 'cf-deterministic', category: 'lic-patterns', validate: r => /LIC-ENT/i.test(r) },
  { input: 'renewal for 5 MR', expect: 'cf-deterministic', category: 'lic-patterns', validate: r => /LIC-ENT/i.test(r) },
  { input: '10 MV licenses 5 year', expect: 'cf-deterministic', category: 'lic-patterns', validate: r => /LIC-MV/i.test(r) },
  { input: 'licenses for 3 MT', expect: 'cf-deterministic', category: 'lic-patterns', validate: r => /LIC-MT/i.test(r) },
  { input: 'quote 5 MR46 hardware only', expect: 'cf-deterministic', category: 'lic-patterns', validate: r => /MR46/i.test(r) && !/LIC-ENT/i.test(r) },

  // ── CATEGORY 24: Multi-product natural language quotes ──
  { input: 'I need 5 MR46 access points and 2 MS225-24P switches and an MX75 firewall with 3 year licenses', expect: 'cf-deterministic', category: 'nl-multi', validate: r => /MR46/i.test(r) },
  { input: 'quote me 10 MR28 and 1 MX67 with 5 year', expect: 'cf-deterministic', category: 'nl-multi', validate: r => /MR28/i.test(r) },
  { input: 'price out 4 CW9166 and 2 MS390-48UX', expect: 'cf-deterministic', category: 'nl-multi', validate: r => /CW9166|MS390/i.test(r) },

  // ── CATEGORY 25: Advisory questions that mention specific SKUs (should NOT quote, routes to Claude) ──
  { input: 'should I get the MR46 or the CW9164', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'tell me about the MX85', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what SFP do I need for the MS225-24P', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'can the MX67 handle 100 VPN tunnels', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'how fast is the MX95', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'specs for the CW9166', expect: 'claude', category: 'advisory-sku', validate: r => /product.?info|Claude/i.test(r) },

  // ── CATEGORY 26: Conversation edge cases ──
  { input: 'you rock', expect: 'cf-conversation', category: 'convo-edge', validate: r => r.length > 5 },
  { input: 'are you a bot', expect: 'cf-conversation', category: 'convo-edge', validate: r => /stratus|bot|assistant|AI/i.test(r) },
  { input: 'what are you', expect: 'cf-conversation', category: 'convo-edge', validate: r => /stratus|quoting|assistant|bot/i.test(r) },
  { input: 'help', expect: ['cf-conversation', 'cf-clarify'], category: 'convo-edge', validate: r => r.length > 10 },
  { input: 'nevermind', expect: 'cf-conversation', category: 'convo-edge', validate: r => r.length > 5 },
  { input: 'thx', expect: 'cf-conversation', category: 'convo-edge', validate: r => r.length > 5 },

  // ── CATEGORY 27: Complex requests that should escalate to Claude ──
  { input: 'compare MX85 vs MX95 vs MX105 for a 3-building campus with 1500 users total', expect: 'claude', category: 'claude-escalate', validate: () => true },
  { input: 'write me a proposal for upgrading from MR33 to CW9164 across 50 sites', expect: 'claude', category: 'claude-escalate', validate: () => true },
  { input: 'what is the total cost of ownership for a full Meraki stack over 5 years for a 200-person office', expect: 'claude', category: 'claude-escalate', validate: () => true },

  // ── CATEGORY 28: EOL products with replacement recommendations ──
  { input: 'is the MR42 end of life', expect: 'deterministic-eol', category: 'eol-dates', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'when does MR33 go EOL', expect: 'deterministic-eol', category: 'eol-dates', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'is MS220-8P still sold', expect: ['deterministic-eol', 'claude'], category: 'eol-dates', validate: r => /eol|end of|MS130|replacement|not|product.?info|Claude/i.test(r) },

  // ── CATEGORY 29: Clarify edge cases — vague product references ──
  { input: 'I need networking equipment', expect: ['cf-clarify', 'cf-conversation'], category: 'clarify-vague', validate: r => /which|what|product|MR|MS|MX|help/i.test(r) },
  { input: 'what do you have', expect: ['cf-clarify', 'cf-conversation', 'claude'], category: 'clarify-vague', validate: r => /quote|product|MR|MS|MX|help|offer|Claude/i.test(r) },
  { input: 'pricing for Meraki', expect: ['cf-clarify', 'cf-conversation'], category: 'clarify-vague', validate: r => /which|what|model|product/i.test(r) },
  { input: 'get me a quote', expect: ['cf-clarify', 'cf-conversation'], category: 'clarify-vague', validate: r => /which|what|model|product|specify/i.test(r) },

  // ── CATEGORY 30: Sentence-embedded quotes (SKU buried in natural language) ──
  { input: 'hey can you get me pricing on 3 MX75 firewalls with 3 year licenses?', expect: 'cf-deterministic', category: 'embedded-quote', validate: r => /MX75/i.test(r) },
  { input: 'our client needs 20 MR46 for their new building', expect: 'cf-deterministic', category: 'embedded-quote', validate: r => /MR46/i.test(r) },
  { input: 'please quote 1 MS390-48UX switch for the server room', expect: 'cf-deterministic', category: 'embedded-quote', validate: r => /MS390/i.test(r) },
  { input: 'we are looking at 6 MV22 cameras for the parking garage, 3 year license', expect: 'cf-deterministic', category: 'embedded-quote', validate: r => /MV22/i.test(r) },

  // ── CATEGORY 31: Question mark sensitivity ──
  { input: 'MR46?', expect: ['cf-clarify', 'claude', 'cf-deterministic'], category: 'qmark', validate: r => /MR46|quote|price|model/i.test(r) },
  { input: 'MX75?', expect: ['cf-clarify', 'claude', 'cf-deterministic'], category: 'qmark', validate: r => /MX75|quote|price|model/i.test(r) },
  { input: 'how much?', expect: ['cf-clarify', 'cf-conversation'], category: 'qmark', validate: r => /which|what|product|model|help/i.test(r) },

  // ── CATEGORY 32: Cellular MX models ──
  { input: 'quote 1 MX67C', expect: 'cf-deterministic', category: 'det-cellular', validate: r => /MX67C/i.test(r) },
  { input: 'quote 1 MX68CW', expect: 'cf-deterministic', category: 'det-cellular', validate: r => /MX68CW/i.test(r) },

  // ── CATEGORY 33: Sensor products (MT) ──
  { input: 'quote 10 MT14', expect: 'cf-deterministic', category: 'det-sensor', validate: r => /MT14/i.test(r) },
  { input: 'quote 5 MT20 and 5 MT40', expect: 'cf-deterministic', category: 'det-sensor', validate: r => /MT20.*MT40|MT40.*MT20/i.test(r) },
  { input: 'do MT sensors need a license', expect: 'claude', category: 'mt-info', validate: r => /MT|sensor|free|license|tier|product.?info|Claude/i.test(r) },
];


// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function runTest(test, index) {
  const encoded = encodeURIComponent(test.input);
  try {
    const raw = execSync(`curl -s "${BASE_URL}?input=${encoded}"`, { timeout: 20000 }).toString();
    const result = JSON.parse(raw);

    const expectedLayers = Array.isArray(test.expect) ? test.expect : [test.expect];
    const layerMatch = expectedLayers.includes(result.layer);
    const responseValid = test.validate(result.response || '');
    const pass = layerMatch && responseValid;

    return {
      index: index + 1,
      input: test.input,
      category: test.category,
      expected: expectedLayers.join('|'),
      actual: result.layer,
      layerOk: layerMatch,
      responseOk: responseValid,
      pass,
      response: (result.response || '').substring(0, 150),
      ms: result.details?.ms || 0,
      cfIntent: result.details?.cfIntent || '',
      details: result.details || {}
    };
  } catch (err) {
    return {
      index: index + 1,
      input: test.input,
      category: test.category,
      expected: Array.isArray(test.expect) ? test.expect.join('|') : test.expect,
      actual: 'ERROR',
      layerOk: false,
      responseOk: false,
      pass: false,
      response: err.message.substring(0, 100),
      ms: 0
    };
  }
}

async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  STRATUS AI BOT — 3-TIER WATERFALL STRESS TEST`);
  console.log(`  ${tests.length} test cases across ${new Set(tests.map(t => t.category)).size} categories`);
  console.log(`${'═'.repeat(80)}\n`);

  const results = [];
  const BATCH_SIZE = 5; // Parallel batch size to avoid overwhelming CF

  for (let i = 0; i < tests.length; i += BATCH_SIZE) {
    const batch = tests.slice(i, i + BATCH_SIZE);
    const batchResults = [];
    for (const [j, test] of batch.entries()) {
      batchResults.push(await runTest(test, i + j));
    }
    results.push(...batchResults);

    // Progress
    const done = Math.min(i + BATCH_SIZE, tests.length);
    const passes = results.filter(r => r.pass).length;
    process.stdout.write(`\r  Progress: ${done}/${tests.length} | Pass: ${passes}/${done}`);
  }

  console.log('\n');

  // ═══════════════════════════════════════════════════════════════
  // RESULTS ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  const failures = results.filter(r => !r.pass);
  const layerMisroutes = results.filter(r => !r.layerOk);
  const badResponses = results.filter(r => r.layerOk && !r.responseOk);

  // Summary by category
  const categories = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = { total: 0, pass: 0, fail: 0 };
    categories[r.category].total++;
    if (r.pass) categories[r.category].pass++;
    else categories[r.category].fail++;
  }

  console.log(`${'─'.repeat(80)}`);
  console.log('  CATEGORY SUMMARY');
  console.log(`${'─'.repeat(80)}`);
  for (const [cat, stats] of Object.entries(categories).sort((a, b) => b[1].fail - a[1].fail)) {
    const status = stats.fail === 0 ? '✅' : '❌';
    console.log(`  ${status} ${cat.padEnd(22)} ${stats.pass}/${stats.total} pass${stats.fail > 0 ? ` (${stats.fail} FAIL)` : ''}`);
  }

  // Layer distribution
  const layers = {};
  for (const r of results) {
    layers[r.actual] = (layers[r.actual] || 0) + 1;
  }
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  LAYER DISTRIBUTION');
  console.log(`${'─'.repeat(80)}`);
  for (const [layer, count] of Object.entries(layers).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / results.length) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / results.length * 40));
    console.log(`  ${layer.padEnd(28)} ${String(count).padStart(3)} (${pct}%) ${bar}`);
  }

  // Detailed failures
  if (failures.length > 0) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  FAILURES (${failures.length})`);
    console.log(`${'─'.repeat(80)}`);
    for (const f of failures) {
      const issue = !f.layerOk ? 'MISROUTE' : 'BAD_RESPONSE';
      console.log(`\n  ${issue} #${f.index} [${f.category}]`);
      console.log(`    Input:    "${f.input}"`);
      console.log(`    Expected: ${f.expected}`);
      console.log(`    Actual:   ${f.actual}${f.cfIntent ? ` (CF intent: ${f.cfIntent})` : ''}`);
      console.log(`    Response: "${f.response}"`);
      if (f.details?.deterministicErrors) console.log(`    DetErrors: ${JSON.stringify(f.details.deterministicErrors)}`);
      if (f.details?.pricingSkuAttempt) console.log(`    PricingSKU: ${f.details.pricingSkuAttempt}`);
    }
  }

  // Latency stats
  const cfResults = results.filter(r => r.actual?.startsWith('cf-'));
  const detResults = results.filter(r => r.actual?.startsWith('deterministic'));
  const cfAvg = cfResults.length > 0 ? Math.round(cfResults.reduce((s, r) => s + r.ms, 0) / cfResults.length) : 0;
  const detAvg = detResults.length > 0 ? Math.round(detResults.reduce((s, r) => s + r.ms, 0) / detResults.length) : 0;

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  LATENCY');
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Deterministic avg: ${detAvg}ms (${detResults.length} requests)`);
  console.log(`  CF Workers AI avg: ${cfAvg}ms (${cfResults.length} requests)`);

  // Final score
  const passRate = ((results.filter(r => r.pass).length / results.length) * 100).toFixed(1);
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  FINAL SCORE: ${results.filter(r => r.pass).length}/${results.length} (${passRate}%)`);
  console.log(`  Misroutes: ${layerMisroutes.length} | Bad Responses: ${badResponses.length}`);
  console.log(`${'═'.repeat(80)}\n`);

  // Output JSON for programmatic analysis
  const jsonOutput = JSON.stringify({ summary: { total: results.length, pass: results.filter(r => r.pass).length, fail: failures.length, misroutes: layerMisroutes.length, badResponses: badResponses.length, layers, categories }, failures, results }, null, 2);
  require('fs').writeFileSync('/tmp/stress-test-results.json', jsonOutput);
  console.log('  Full results saved to /tmp/stress-test-results.json\n');
}

main().catch(console.error);
