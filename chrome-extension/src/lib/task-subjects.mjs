const PLACEHOLDER_ROOT_RE = /^(?:undefined|null|nan|\[object object\])(?:\s*[-:].*)?$/i;
const EMBEDDED_ENTITY_PLACEHOLDER_RE = /\b(?:deal|account|contact)\s+(?:undefined|null|nan|\[object object\])(?:\s*[-:]|$)/i;
const LEGACY_FOLLOW_UP_RE = /^follow\s*-?\s*up\s*[:\-]\s*/i;
const NUMBERED_FOLLOW_UP_RE = /^(\d+)(?:st|nd|rd|th)\s+follow[- ]up\s*:\s*/i;

const WORD_ORDINALS = new Map([
  ['first', 1], ['second', 2], ['third', 3], ['fourth', 4], ['fifth', 5],
  ['sixth', 6], ['seventh', 7], ['eighth', 8], ['ninth', 9], ['tenth', 10],
  ['eleventh', 11], ['twelfth', 12], ['thirteenth', 13], ['fourteenth', 14],
  ['fifteenth', 15], ['sixteenth', 16], ['seventeenth', 17], ['eighteenth', 18],
  ['nineteenth', 19], ['twentieth', 20],
]);
const WORD_FOLLOW_UP_RE = new RegExp(`^(${[...WORD_ORDINALS.keys()].join('|')})\\s+follow[- ]up\\s*:\\s*`, 'i');

export function requiredBusinessText(value, label = 'Value') {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is missing`);
  if (PLACEHOLDER_ROOT_RE.test(text) || EMBEDDED_ENTITY_PLACEHOLDER_RE.test(text)) {
    throw new Error(`${label} contains placeholder text`);
  }
  return text;
}

function ordinalLabel(value) {
  const words = [...WORD_ORDINALS.entries()].find(([, number]) => number === value)?.[0];
  if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  return `${value}${suffix}`;
}

function followUpLevel(subject) {
  let text = String(subject || '').trim();
  let legacyCount = 0;
  let numberedLevel = 0;
  let changed = true;
  while (changed && text) {
    changed = false;
    const legacy = text.match(LEGACY_FOLLOW_UP_RE);
    if (legacy) {
      legacyCount += 1;
      text = text.slice(legacy[0].length).trim();
      changed = true;
      continue;
    }
    const numbered = text.match(NUMBERED_FOLLOW_UP_RE);
    if (numbered) {
      numberedLevel = Math.max(numberedLevel, Number(numbered[1]));
      text = text.slice(numbered[0].length).trim();
      changed = true;
      continue;
    }
    const word = text.match(WORD_FOLLOW_UP_RE);
    if (word) {
      numberedLevel = Math.max(numberedLevel, WORD_ORDINALS.get(word[1].toLowerCase()) || 0);
      text = text.slice(word[0].length).trim();
      changed = true;
    }
  }
  return { base: requiredBusinessText(text, 'Task subject'), legacyCount, numberedLevel };
}

// Input is the CURRENT task subject. The returned subject is the next successor:
// original -> First, legacy Follow up -> Second, First -> Second, and so on.
export function nextFollowUpSubject(currentSubject) {
  const { base, legacyCount, numberedLevel } = followUpLevel(requiredBusinessText(currentSubject, 'Task subject'));
  const currentLevel = numberedLevel > 0
    ? numberedLevel + legacyCount
    : legacyCount;
  const nextLevel = Math.max(1, currentLevel + 1);
  return `${ordinalLabel(nextLevel)} Follow-Up: ${base}`;
}

export function isOrdinalFollowUpSubject(value) {
  const text = String(value || '').trim();
  return NUMBERED_FOLLOW_UP_RE.test(text) || WORD_FOLLOW_UP_RE.test(text);
}
