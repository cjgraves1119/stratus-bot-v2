// Loads a worker index.js given globalThis.WORKER_DIR. Set it before load().
if (typeof console === 'undefined') globalThis.console = { log: print, warn: print, error: print, info: print, debug: function(){} };
if (typeof fetch === 'undefined') globalThis.fetch = function () { throw new Error('no fetch'); };
if (typeof crypto === 'undefined') globalThis.crypto = { randomUUID: function(){ return 'uuid'; }, getRandomValues: function(a){ return a; } };
if (typeof btoa === 'undefined') globalThis.btoa = function (s) { return s; };
if (typeof atob === 'undefined') globalThis.atob = function (s) { return s; };
if (typeof TextEncoder === 'undefined') globalThis.TextEncoder = function(){ this.encode = function(s){ return s; }; };
if (typeof TextDecoder === 'undefined') globalThis.TextDecoder = function(){ this.decode = function(s){ return s; }; };
if (typeof Response === 'undefined') globalThis.Response = function(){};
if (typeof Request === 'undefined') globalThis.Request = function(){};
if (typeof Headers === 'undefined') globalThis.Headers = function(){};
if (typeof URL === 'undefined') globalThis.URL = function(u){ this.href = u; };
if (typeof caches === 'undefined') globalThis.caches = {};
(function () {
  var dir = globalThis.WORKER_DIR;
  var file = globalThis.WORKER_FILE || (dir + "/src/index.js");
  var src = readFile(file);
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, function (_, name, rel) {
    globalThis.__json = globalThis.__json || {};
    globalThis.__json[name] = JSON.parse(readFile(dir + "/src/" + rel.replace(/^\.\//, '')));
    return "const " + name + " = globalThis.__json." + name + ";";
  });
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, "const WorkflowEntrypoint = class {};");
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, "$1 ");
  var ed = src.indexOf("export default");
  if (ed > -1) {
    var depth = 0, started = false, end = ed;
    for (var i = ed; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      else if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, ed) + src.slice(end + 1);
  }
  (0, eval)(src);
})();
