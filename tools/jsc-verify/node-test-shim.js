// Minimal node:test + node:assert shim so the real .mjs test files can be
// executed under jsc on a machine with no node runtime.
globalThis.__testFails = 0; globalThis.__testPass = 0;
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a).filter(function(k){ return a[k] !== undefined; });
  var kb = Object.keys(b).filter(function(k){ return b[k] !== undefined; });
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) { if (!deepEq(a[ka[i]], b[ka[i]])) return false; }
  return true;
}
function fail(msg) { var e = new Error(msg); e.__assert = true; throw e; }
globalThis.assert = function (v, m) { if (!v) fail(m || 'assertion failed'); };
globalThis.assert.ok = function (v, m) { if (!v) fail(m || 'expected truthy, got ' + JSON.stringify(v)); };
globalThis.assert.equal = function (a, b, m) { if (a !== b) fail(m || ('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a))); };
globalThis.assert.deepEqual = function (a, b, m) { if (!deepEq(a, b)) fail(m || ('deepEqual failed\n   got  ' + JSON.stringify(a) + '\n   want ' + JSON.stringify(b))); };
globalThis.assert.match = function (s, re, m) { if (!re.test(String(s))) fail(m || ('expected ' + re + ' to match:\n' + String(s).slice(0, 400))); };
globalThis.assert.doesNotMatch = function (s, re, m) { if (re.test(String(s))) fail(m || ('expected ' + re + ' NOT to match:\n' + String(s).slice(0, 400))); };

globalThis.assert.strictEqual = globalThis.assert.equal;
globalThis.assert.notEqual = function (a, b, m) { if (a === b) fail(m || ('expected values to differ, both ' + JSON.stringify(a))); };
globalThis.assert.notStrictEqual = globalThis.assert.notEqual;
globalThis.assert.deepStrictEqual = globalThis.assert.deepEqual;
globalThis.assert.notDeepEqual = function (a, b, m) { if (deepEq(a, b)) fail(m || 'expected objects to differ'); };
globalThis.assert.throws = function (fn, _e, m) { var threw = false; try { fn(); } catch (e) { threw = true; } if (!threw) fail(m || 'expected function to throw'); };
globalThis.assert.doesNotThrow = function (fn, m) { try { fn(); } catch (e) { fail(m || ('unexpected throw: ' + e)); } };
globalThis.assert.fail = function (m) { fail(m || 'assert.fail'); };
globalThis.test = function (name, fn) {
  try { fn(); globalThis.__testPass++; print("  ok   " + name); }
  catch (e) { globalThis.__testFails++; print("  FAIL " + name + "\n       " + (e && e.message ? e.message : e)); }
};
