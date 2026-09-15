import type { ApiErrorDto } from '@scribe/shared';

/**
 * Application error with an HTTP status and a stable machine-readable `code`.
 * The global error handler serializes these into the {@link ApiErrorDto}
 * envelope. Internal messages/stack traces are never leaked for 5xx errors.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: Record<string, string[]>) =>
    new AppError(400, 'validation_error', 'Request validation failed', details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'unauthorized', message),
  // Access control deliberately returns 404, not 403, to avoid leaking existence
  // (see docs/architecture/security.md — document access enumeration).
  notFound: (message = 'Not found') => new AppError(404, 'not_found', message),
  // Used only when the user CAN see the resource but lacks the role for this
  // action (e.g. a viewer trying to edit) — existence is not being leaked.
  forbidden: (message = 'Insufficient permissions') => new AppError(403, 'forbidden', message),
  conflict: (message: string) => new AppError(409, 'conflict', message),
  badRequest: (message = 'Bad request') => new AppError(400, 'bad_request', message),
  // Media uploads: content that is too large or of an unsupported type.
  payloadTooLarge: (message = 'Payload too large') =>
    new AppError(413, 'payload_too_large', message),
  unsupportedMediaType: (message = 'Unsupported media type') =>
    new AppError(415, 'unsupported_media_type', message),
} as const;

export function toErrorDto(err: AppError): ApiErrorDto {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
