import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const apiRoot = "api";
const maxFunctions = 12;

async function collectFunctions(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const functions = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;

    const relative = prefix ? join(prefix, entry.name) : entry.name;
    const absolute = join(dir, entry.name);

    if (entry.isDirectory()) {
      functions.push(...(await collectFunctions(absolute, relative)));
      continue;
    }

    if (entry.isFile() && /\.(js|ts)$/.test(entry.name)) {
      functions.push(relative);
    }
  }

  return functions;
}

const functions = (await collectFunctions(apiRoot)).sort();

assert.ok(
  functions.length <= maxFunctions,
  `Vercel Hobby allows ${maxFunctions} Serverless Functions; found ${functions.length}: ${functions.join(", ")}`,
);

assert.equal(functions.includes("top8-run.js"), false, "Legacy top8-run must not be deployed as a production function");
assert.equal(functions.includes("top8-batch.js"), false, "Legacy top8-batch must not be deployed as a production function");
assert.equal(functions.includes("top8-final.js"), false, "Legacy top8-final must not be deployed as a production function");

console.log(`Vercel Hobby function count validation OK: ${functions.length}/${maxFunctions} functions.`);
