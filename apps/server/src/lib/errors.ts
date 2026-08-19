/** Typed application errors that map cleanly onto HTTP responses. */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** The request is malformed or fails validation. */
export const badRequest = (message: string, code = 'bad_request') =>
  new AppError(400, code, message);

/** No valid session. */
export const unauthorized = (message = 'Sign in to continue.') =>
  new AppError(401, 'unauthorized', message);

/** Signed in, but not allowed. Also used where existence itself is private. */
export const forbidden = (message = "You don't have access to that.") =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = "That doesn't exist.") =>
  new AppError(404, 'not_found', message);

export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many attempts. Try again shortly.') =>
  new AppError(429, 'rate_limited', message);
