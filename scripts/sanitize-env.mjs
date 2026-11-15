import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Strip stray quotes in PATH (e.g. broken Windows system PATH entries)
 * and prepend ~/.cargo/bin when present so Rust/Cargo and yt-dlp resolve reliably.
 */
export function sanitizePathEnv(env = process.env) {
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const hasCargoDir = fs.existsSync(cargoBin);

  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") {
      const cleaned = (env[key] || "").replace(/"/g, "");
      const parts = cleaned.split(path.delimiter).filter(Boolean);
      const rest = parts.filter(
        (entry) => entry.toLowerCase() !== cargoBin.toLowerCase()
      );
      env[key] = (hasCargoDir ? [cargoBin, ...rest] : parts).join(
        path.delimiter
      );
    }
  }
}
