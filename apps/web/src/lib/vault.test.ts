import { describe, expect, it } from 'vitest';
import { createVault, decryptText, encryptText, generatePassword, unlockVault } from './vault';

describe('vault crypto', () => {
  it('encrypts with the master password and rejects a wrong one', async () => {
    const { meta, key } = await createVault('correct horse battery');
    const c = await encryptText(key, 'instagram-pass-123');
    expect(c.data).not.toContain('instagram');
    const again = await unlockVault(meta, 'correct horse battery');
    expect(again).not.toBeNull();
    expect(await decryptText(again!, c)).toBe('instagram-pass-123');
    expect(await unlockVault(meta, 'wrong password')).toBeNull();
  }, 20_000);
  it('generates strong passwords', () => {
    const p = generatePassword();
    expect(p).toHaveLength(18);
    expect(generatePassword()).not.toBe(p);
  });
});
