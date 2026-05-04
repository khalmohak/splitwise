export type ErrorDetails = Record<string, string>;

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: ErrorDetails;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const validationError = (details: ErrorDetails): HttpError =>
  new HttpError(400, "Validation failed", "VALIDATION_ERROR", details);
