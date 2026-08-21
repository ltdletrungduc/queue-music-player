import { describe, expect, it } from 'vitest';
import { admits, readAccess } from './access.js';

const access = { joinCode: 'letmein', playerPassword: 'speaker' };

describe('reading the Room\'s secrets from configuration', () => {
  it('reads them when they are set', () => {
    expect(readAccess({ JOIN_CODE: 'letmein', PLAYER_PASSWORD: 'speaker' })).toEqual(access);
  });

  it.each([
    ['no Join Code', { PLAYER_PASSWORD: 'speaker' }],
    ['no Player password', { JOIN_CODE: 'letmein' }],
    ['an empty Join Code', { JOIN_CODE: '', PLAYER_PASSWORD: 'speaker' }],
    ['a blank Player password', { JOIN_CODE: 'letmein', PLAYER_PASSWORD: '   ' }]
  ])('refuses to start with %s', (_, env) => {
    // Starting without them would open the Room to anyone who finds the address,
    // silently. Better to refuse to start at all than to look like it worked.
    expect(() => readAccess(env)).toThrow(/JOIN_CODE|PLAYER_PASSWORD/);
  });
});

describe('who is let into the Room', () => {
  it('admits a Controller who knows the Join Code', () => {
    expect(admits(access, { role: 'controller', joinCode: 'letmein' })).toEqual({ ok: true, role: 'controller' });
  });

  it('turns away a Controller with the wrong Join Code', () => {
    expect(admits(access, { role: 'controller', joinCode: 'guess' })).toEqual({
      ok: false,
      reason: 'That code is not right.'
    });
  });

  it('turns away a Controller with no Join Code at all', () => {
    expect(admits(access, { role: 'controller' }).ok).toBe(false);
  });

  it('admits the Player when it knows the Player password', () => {
    expect(admits(access, { role: 'player', playerPassword: 'speaker' })).toEqual({ ok: true, role: 'player' });
  });

  it('turns away a Player with the wrong password', () => {
    expect(admits(access, { role: 'player', playerPassword: 'letmein' })).toEqual({
      ok: false,
      reason: 'That password is not right.'
    });
  });

  it('does not let the Join Code open the Player', () => {
    // The two gates are separate on purpose: a guest holding the Join Code must
    // not be able to take the speaker.
    expect(admits(access, { role: 'player', playerPassword: 'letmein' }).ok).toBe(false);
    expect(admits(access, { role: 'controller', joinCode: 'speaker' }).ok).toBe(false);
  });

  it('turns away anyone claiming a role that does not exist', () => {
    expect(admits(access, { role: 'gatecrasher', joinCode: 'letmein' }).ok).toBe(false);
  });

  it('is not fooled by a value that merely starts the same way', () => {
    expect(admits(access, { role: 'controller', joinCode: 'letmein-and-more' }).ok).toBe(false);
    expect(admits(access, { role: 'controller', joinCode: 'letmei' }).ok).toBe(false);
  });
});
