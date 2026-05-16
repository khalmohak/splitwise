import { neon } from "@neondatabase/serverless";
import { env } from "./env.js";

const sql = neon(env.DATABASE_URL);

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  const rows = (await sql(text, params)) as T[];
  return { rows };
}

export { db } from "../db/client.js";
