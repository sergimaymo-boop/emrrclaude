import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const includeBundle = process.argv.includes("--include-bundle");
const productionRetiredValidators = new Set([
  "validate-phase6.mjs",
  "validate-phase7.mjs",
  "validate-phase8.mjs",
  "validate-phase9.mjs",
  "validate-phase11.mjs",
]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

const scripts = (await readdir("scripts"))
  .filter((file) => file.startsWith("validate-") && file.endsWith(".mjs"))
  .filter((file) => includeBundle || file !== "validate-production-bundle-no-mock-fixed-top8.mjs")
  .filter((file) => file !== "validate-vercel-production-deploy.mjs")
  .filter((file) => !productionRetiredValidators.has(file))
  .sort();

for (const script of scripts) {
  console.log(`\n> node ${join("scripts", script)}`);
  await run("node", [join("scripts", script)]);
}

console.log("\nAll validators completed OK.");
