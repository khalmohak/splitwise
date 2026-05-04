import type { ErrorRequestHandler, RequestHandler } from "express";

import { HttpError } from "../utils/http-error";

export const notFoundHandler: RequestHandler = () => {
  throw new HttpError(404, "Resource not found", "NOT_FOUND");
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (
    error instanceof SyntaxError &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({
      error: "Malformed JSON body",
      code: "BAD_REQUEST",
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  console.error("Unhandled request error.", error);
  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_SERVER_ERROR",
  });
};
