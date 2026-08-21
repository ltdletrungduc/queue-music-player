import { describe, expect, it } from 'vitest';
import { isFromThisMachine } from './local-only.js';

describe('telling this machine from everywhere else', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts %s with nothing forwarded', (address) => {
    expect(isFromThisMachine(address, {})).toBe(true);
  });

  it.each(['192.168.1.20', '10.0.0.5', '203.0.113.7'])('refuses %s', (address) => {
    expect(isFromThisMachine(address, {})).toBe(false);
  });

  it('refuses a request with no address at all', () => {
    expect(isFromThisMachine(undefined, {})).toBe(false);
  });

  it.each(['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'])(
    'refuses loopback carrying %s, because a tunnel proxies from localhost',
    (header) => {
      expect(isFromThisMachine('127.0.0.1', { [header]: '203.0.113.7' })).toBe(false);
    }
  );

  it('is not fooled by an empty forwarding header', () => {
    expect(isFromThisMachine('127.0.0.1', { 'x-forwarded-for': '' })).toBe(false);
  });
});
