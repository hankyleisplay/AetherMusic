import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizePathEnv } from "./sanitize-env.mjs";

sanitizePathEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriCliEntry = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js"
);

const result = spawnSync(process.execPath, [tauriCliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
