import { describe, it, expect } from 'vitest';
import { resolveTheme, DEFAULT_THEME, THEME_IDS, isThemeId } from '@/lib/theme/themes';

describe('theme-registry', () => {
  it('default is professional', () => {
    expect(DEFAULT_THEME).toBe('professional');
  });

  it('THEME_IDS includes professional and professional-dark', () => {
    expect(THEME_IDS).toContain('professional');
    expect(THEME_IDS).toContain('professional-dark');
    expect(THEME_IDS).toContain('editorial');
    expect(THEME_IDS).toContain('brutalist');
  });

  it('terminal is treated as professional alias for back-compat', () => {
    expect(resolveTheme('terminal')).toBe('professional');
  });

  it('professional and professional-dark resolve to themselves', () => {
    expect(resolveTheme('professional')).toBe('professional');
    expect(resolveTheme('professional-dark')).toBe('professional-dark');
  });

  it('unknown values fall back to DEFAULT_THEME', () => {
    expect(resolveTheme('nonsense')).toBe(DEFAULT_THEME);
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('isThemeId is type guard', () => {
    expect(isThemeId('professional')).toBe(true);
    expect(isThemeId('professional-dark')).toBe(true);
    expect(isThemeId('editorial')).toBe(true);
    expect(isThemeId('brutalist')).toBe(true);
    expect(isThemeId('terminal')).toBe(true); // alias still valid
    expect(isThemeId('nonsense')).toBe(false);
  });
});