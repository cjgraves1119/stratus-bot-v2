import io, re, sys, subprocess, os
SP = os.path.dirname(os.path.abspath(__file__))
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
WC = os.path.dirname(os.path.dirname(SP))

test_file = sys.argv[1]
kind = sys.argv[2]  # 'worker' or 'ext'
src = io.open(test_file, encoding="utf-8").read()

# drop ESM imports
src = re.sub(r"^import[^;]*;\s*$", "", src, flags=re.M)
# drop the extractor helper entirely and bind `mod` to the global scope
src = re.sub(r"function extractRealFunctions\(\)\s*\{.*?\n\}\n", "", src, flags=re.S)
src = src.replace("const mod = extractRealFunctions();", "const mod = globalThis;")
src = src.replace("const __dirname = path.dirname(fileURLToPath(import.meta.url));", "")
src = src.replace("const require = createRequire(import.meta.url);", "")
# neutralize remaining import.meta usages (path resolution in older test files)
src = re.sub(r"new URL\('([^']+)',\s*import\.meta\.url\)", lambda m: '(globalThis.__EXT + "/%s")' % m.group(1).lstrip("./"), src)
src = src.replace("fileURLToPath(import.meta.url)", "globalThis.__EXT")
src = src.replace("import.meta.url", '"file://" + globalThis.__EXT + "/x.mjs"')

if kind == "worker":
    preload = 'globalThis.SP="%s"; globalThis.WORKER_DIR="%s/worker-gchat"; load(globalThis.SP+"/loader.js");' % (SP, WC)
else:
    harness = "jsc-ext-harness-pristine.js" if os.environ.get("PRISTINE") else "jsc-ext-harness.js"
    preload = 'load("%s/%s");' % (SP, harness)

runner = '%s\nload("%s/node-test-shim.js");\n%s\nprint("\\n  %%d passed, %%d failed".replace("%%d", "").length ? "" : "");\nprint("");\nprint("  " + globalThis.__testPass + " passed, " + globalThis.__testFails + " failed");\nif (globalThis.__testFails > 0) { throw new Error("TEST FAILURES: " + globalThis.__testFails); }\n' % (preload, SP, src)

out_path = os.path.join(SP, "run-" + os.path.basename(test_file).replace(".mjs", "") + ".js")
io.open(out_path, "w", encoding="utf-8").write(runner)
print("== " + os.path.basename(test_file))
r = subprocess.run([JSC, out_path], capture_output=True, text=True)
print(r.stdout.rstrip())
if r.returncode != 0:
    print(r.stderr.rstrip()[:2000])
sys.exit(r.returncode)
