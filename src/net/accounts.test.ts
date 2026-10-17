import { describe, expect, it } from 'vitest';
import { passwordOk, passwordRules, usernameProblem } from './accounts';

describe('Account rules', () => {
  it('needs 8+ characters with a letter and a number', () => {
    expect(passwordOk('abc12345')).toBe(true);
    expect(passwordOk('abc1234')).toBe(false);
    expect(passwordOk('abcdefgh')).toBe(false);
    expect(passwordOk('12345678')).toBe(false);
    expect(passwordOk('a1'.repeat(37))).toBe(false);
    expect(passwordRules('short1').filter((r) => !r.ok).map((r) => r.text)).toEqual(['At least 8 characters']);
  });

  it('allows 3-16 letters, numbers, _ . - in usernames', () => {
    expect(usernameProblem('max_33')).toBeNull();
    expect(usernameProblem('ab')).not.toBeNull();
    expect(usernameProblem('a'.repeat(17))).not.toBeNull();
    expect(usernameProblem('max verstappen')).not.toBeNull();
  });
});
