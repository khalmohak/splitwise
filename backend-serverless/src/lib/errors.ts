import type { Context } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";

// Mirror of the reference backend's error shape:
//   { error: <message>, code: <UPPER_SNAKE_CODE>, details?: { field: msg } }
// Hono's built-in HTTPException only carries message + status, so we use our
// own class everywhere we'd previously have used HttpError on Express.
export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, string>;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function validationError(details: Record<string, string>): HttpError {
  return new HttpError(400, "Validation failed", "VALIDATION_ERROR", details);
}

export function notFound(message = "Resource not found"): HttpError {
  return new HttpError(404, message, "NOT_FOUND");
}

export function forbidden(message = "Forbidden"): HttpError {
  return new HttpError(403, message, "FORBIDDEN");
}

export function conflict(message: string, code = "CONFLICT"): HttpError {
  return new HttpError(409, message, code);
}

export function unprocessable(message: string, code = "UNPROCESSABLE"): HttpError {
  return new HttpError(422, message, code);
}

export function badRequest(message: string, code = "BAD_REQUEST"): HttpError {
  return new HttpError(400, message, code);
}

export function unauthorized(message = "Unauthorized"): HttpError {
  return new HttpError(401, message, "UNAUTHORIZED");
}

export function respondError(c: Context, err: unknown) {
  if (err instanceof HttpError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    if (err.details) body.details = err.details;
    return c.json(body, err.statusCode as ContentfulStatusCode);
  }
  // Surface Hono's HTTPException for back-compat with existing routes.
  if (typeof err === "object" && err !== null && "status" in err && "message" in err) {
    const status = (err as { status: number }).status;
    const message = (err as { message: string }).message;
    const body: Record<string, unknown> = { error: message, code: codeFromStatus(status) };
    // parseJson stuffs ZodError.flatten() into `cause` for 422s — propagate
    // the field errors so clients can see what failed.
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "fieldErrors" in cause) {
      body.details = (cause as { fieldErrors: Record<string, unknown> }).fieldErrors;
    }
    return c.json(body, status as ContentfulStatusCode);
  }
  console.error("unhandled error", err);
  return c.json(
    { error: "Internal server error", code: "INTERNAL_SERVER_ERROR" },
    500,
  );
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE";
    default:
      return status >= 500 ? "INTERNAL_SERVER_ERROR" : "ERROR";
  }
}
