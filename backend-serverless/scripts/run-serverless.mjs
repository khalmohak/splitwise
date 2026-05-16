#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);

const [, , stage = "dev", ...serverlessArgs] = process.argv;

if (!["dev", "prod"].includes(stage)) {
  console.error(`Unknown stage "${stage}". Expected "dev" or "prod".`);
  process.exit(1);
}

if (serverlessArgs.length === 0) {
  console.error("Missing Serverless command. Example: node scripts/run-serverless.mjs dev deploy");
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

const serverlessBin = require.resolve("serverless/scripts/serverless.js");
const args = [serverlessBin, ...serverlessArgs];
if (!serverlessArgs.includes("--stage")) {
  args.push("--stage", stage);
}

console.log(`[env] loaded ${envFile}`);

const child = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 0);
