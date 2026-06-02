import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function bin(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  return join("node_modules", ".bin", executable);
}

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${label}`);
    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

await run("source validators", "node", [join("scripts", "run-all-validators.mjs")]);

const tsc = bin("tsc");
const vite = bin("vite");

if (!existsSync(tsc)) {
  throw new Error("TypeScript binary not found. Run npm install before npm run build.");
}

if (!existsSync(vite)) {
  throw new Error("Vite binary not found. Run npm install before npm run build.");
}

await run("typecheck", tsc, ["-b"]);
await run("vite build", vite, ["build"]);
await run("production bundle no-mock/fixed-top8 gate", "node", [
  join("scripts", "validate-production-bundle-no-mock-fixed-top8.mjs"),
  "--require-dist",
]);

console.log("\nProduction build completed with no mock/fixed TOP 8 bundle markers.");
