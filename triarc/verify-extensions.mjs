import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadExtensions } from "../packages/coding-agent/dist/core/extensions/loader.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = ["triarc/vendor/antigravity/index.ts", "triarc/extensions/braintrust.ts"];
const titan = ["titan-harness/titan-harness.ts", "ctx-picker.ts", "stack-settings.ts", "titan-child-hooks.ts"].map(p => `triarc/vendor/titan-harness/extensions/${p}`);
for (const [name, paths] of [["default", base], ["titan", [...base, ...titan]]]) {
  const result = await loadExtensions(paths.map(p => root + p), root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, paths.length);
  const commands = result.extensions.flatMap(e => [...e.commands.keys()]);
  if (name === "default") assert.equal(commands.some(c => c.startsWith("titan")), false);
  console.log(`${name}: PASS (${result.extensions.length} extensions, ${commands.length} commands)`);
}
