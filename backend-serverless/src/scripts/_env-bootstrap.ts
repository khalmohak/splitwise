// Loaded first by scripts/seed.ts. Pulls in .env, then stubs env vars that
// lib/env.ts validates as required but the seed never actually uses (S3 etc.).
// Must run before any module that imports lib/env.ts.
import "dotenv/config";

process.env.S3_BUCKET ??= "seed-script-not-used";
