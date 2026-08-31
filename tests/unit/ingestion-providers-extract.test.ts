import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from '@/lib/ingestion/providers/extract';

describe('parseGitHubUrl — valid forms', () => {
  it('parses https URL', () => {
    expect(parseGitHubUrl('https://github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('parses https URL with .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('parses http URL', () => {
    expect(parseGitHubUrl('http://github.com/o/n')).toEqual({ owner: 'o', name: 'n' });
  });

  it('parses URL without scheme', () => {
    expect(parseGitHubUrl('github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('parses SSH shorthand', () => {
    expect(parseGitHubUrl('git@github.com:vercel/next.js.git')).toEqual({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('parses URL with trailing slash', () => {
    expect(parseGitHubUrl('https://github.com/o/n/')).toEqual({ owner: 'o', name: 'n' });
  });

  it('parses owner with dots and dashes', () => {
    expect(parseGitHubUrl('https://github.com/my.org/my-repo.js')).toEqual({
      owner: 'my.org',
      name: 'my-repo.js',
    });
  });

  it('is case-insensitive on host', () => {
    expect(parseGitHubUrl('https://GITHUB.COM/o/n')).toEqual({ owner: 'o', name: 'n' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseGitHubUrl('  https://github.com/o/n  \n')).toEqual({
      owner: 'o',
      name: 'n',
    });
  });
});

describe('parseGitHubUrl — invalid forms', () => {
  it('returns null for empty string', () => {
    expect(parseGitHubUrl('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseGitHubUrl('   ')).toBeNull();
  });

  it('returns null for GitLab URL', () => {
    expect(parseGitHubUrl('https://gitlab.com/foo/bar')).toBeNull();
  });

  it('returns null for Bitbucket URL', () => {
    expect(parseGitHubUrl('https://bitbucket.org/foo/bar')).toBeNull();
  });

  it('returns null for malformed GitHub URL (no owner/name)', () => {
    expect(parseGitHubUrl('https://github.com/')).toBeNull();
  });

  it('returns null for arbitrary text', () => {
    expect(parseGitHubUrl('this is not a url')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseGitHubUrl(null)).toBeNull();
    expect(parseGitHubUrl(undefined)).toBeNull();
    expect(parseGitHubUrl(42)).toBeNull();
    expect(parseGitHubUrl({})).toBeNull();
  });
});