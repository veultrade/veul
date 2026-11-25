// Reads the Replicate API token for the asset scripts, without ever printing it.
// Order: the REPLICATE_API_TOKEN environment variable, then REPLICATE_API_TOKEN in the file named by
// REPLICATE_TOKEN_FILE, then REPLICATE_API_TOKEN in the project's own .dev.vars (gitignored).
// REPLICATE_TOKEN_KEY renames the variable to look for in those files (for a file that holds several tokens).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function replicateToken() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  const files = [process.env.REPLICATE_TOKEN_FILE, path.join(projectDir, ".dev.vars")].filter(Boolean);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const key = process.env.REPLICATE_TOKEN_KEY || "REPLICATE_API_TOKEN";
    const match = readFileSync(file, "utf8").match(new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]+)`, "m"));
    if (match) return match[1];
  }
  throw new Error("No Replicate token: set REPLICATE_API_TOKEN, or REPLICATE_TOKEN_FILE, or add it to .dev.vars");
}
