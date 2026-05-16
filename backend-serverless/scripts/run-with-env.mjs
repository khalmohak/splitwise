#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const [, , stage = "dev", command, ...args] = process.argv;

if (!["dev", "prod"].includes(stage)) {
  console.error(`Unknown stage "${stage}". Expected "dev" or "prod".`);
  process.exit(1);
}

if (!command) {
  console.error("Missing command. Example: node scripts/run-with-env.mjs dev drizzle-kit migrate");
  process.exit(1);
}

const envFile = `.env.${stage}`;
if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Create it from env.${stage}.example first.`);
  process.exit(1);
}

const result = dotenv.config({ path: envFile, override: true });
if (result.error) {
  console.error(`Failed to load ${envFile}:`, result.error.message);
  process.exit(1);
}

console.log(`[env] loaded ${envFile}`);

const child = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 0);
