load(globalThis.SP + "/loader.js");
load(globalThis.SP + "/corpus.js");
var out = [];
for (var i = 0; i < CORPUS.length; i++) {
  var input = CORPUS[i];
  var rec = { input: input };
  try {
    var p = parseMessage(input);
    rec.parsed = p;
    if (p) {
      try { var q = buildQuoteResponse(p); rec.msg = q && q.message; rec.needsLlm = q && q.needsLlm; }
      catch (e) { rec.quoteError = String(e); }
    }
  } catch (e) { rec.parseError = String(e); }
  out.push(rec);
}
print(JSON.stringify(out, null, 1));
