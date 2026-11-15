import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "// [AetherMusic PATH sanitizer]";
const SNIPPET = `${MARKER}
;(() => {
  const fs = require('fs')
  const os = require('os')
  const p = require('path')
  const cargoBin = p.join(os.homedir(), '.cargo', 'bin')
  const hasCargoDir = fs.existsSync(cargoBin)
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase() === 'PATH') {
      const cleaned = (process.env[key] || '').replace(/"/g, '')
      const parts = cleaned.split(p.delimiter).filter(Boolean)
      const rest = parts.filter((x) => x.toLowerCase() !== cargoBin.toLowerCase())
      process.env[key] = (hasCargoDir ? [cargoBin, ...rest] : parts).join(p.delimiter)
    }
  }
})()
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js"
);

if (!fs.existsSync(targetPath)) {
  process.exit(0);
}

const original = fs.readFileSync(targetPath, "utf8");
if (original.includes(MARKER)) {
  process.exit(0);
}

const shebangMatch = original.match(/^#![^\r\n]*\r?\n/);
const patched = shebangMatch
  ? `${shebangMatch[0]}${SNIPPET}\n${original.slice(shebangMatch[0].length)}`
  : `${SNIPPET}\n${original}`;

fs.writeFileSync(targetPath, patched, "utf8");
console.log("[AetherMusic] Patched @tauri-apps/cli/tauri.js PATH sanitizer.");
