export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', 400, message);
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super('AUTH_ERROR', 401, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', 404, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, retryAfterSeconds: number) {
    super('RATE_LIMITED', 429, message, retryAfterSeconds);
  }
}

export class GitHubError extends AppError {
  constructor(code: string, status: number, message: string) {
    super(code, status, message);
  }
}

export class GitHubUnavailable extends AppError {
  constructor(message: string) {
    super('GITHUB_UNAVAILABLE', 503, message);
  }
}
