import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodSchema } from "zod";

export async function parseJson<T>(c: Context, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new HTTPException(422, { message: "validation failed", cause: err.flatten() });
    }
    throw err;
  }
}
