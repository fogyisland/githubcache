import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  RateLimitError,
  GitHubError,
  GitHubUnavailable,
} from '@/lib/errors';

describe('error classes', () => {
  it('AppError sets code, httpStatus, and message', () => {
    const e = new AppError('X', 418, 'teapot');
    expect(e.code).toBe('X');
    expect(e.httpStatus).toBe(418);
    expect(e.message).toBe('teapot');
    expect(e.retryAfter).toBeUndefined();
    expect(e.name).toBe('AppError');
  });

  it('ValidationError → 400', () => {
    const e = new ValidationError('bad input');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.httpStatus).toBe(400);
  });

  it('AuthError → 401', () => {
    const e = new AuthError('nope');
    expect(e.code).toBe('AUTH_ERROR');
    expect(e.httpStatus).toBe(401);
  });

  it('NotFoundError → 404', () => {
    const e = new NotFoundError('gone');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.httpStatus).toBe(404);
  });

  it('RateLimitError carries retryAfter', () => {
    const e = new RateLimitError('slow down', 30);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.httpStatus).toBe(429);
    expect(e.retryAfter).toBe(30);
  });

  it('GitHubError takes custom code and status', () => {
    const e = new GitHubError('GH_FORBIDDEN', 403, 'private');
    expect(e.code).toBe('GH_FORBIDDEN');
    expect(e.httpStatus).toBe(403);
  });

  it('GitHubUnavailable → 503', () => {
    const e = new GitHubUnavailable('down');
    expect(e.code).toBe('GITHUB_UNAVAILABLE');
    expect(e.httpStatus).toBe(503);
  });

  it('subclasses are AppError instances', () => {
    expect(new ValidationError('x')).toBeInstanceOf(AppError);
    expect(new RateLimitError('x', 1)).toBeInstanceOf(AppError);
    expect(new GitHubUnavailable('x')).toBeInstanceOf(AppError);
  });
});
