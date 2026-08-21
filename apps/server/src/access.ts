import { timingSafeEqual } from 'node:crypto';

export type Role = 'controller' | 'player';

/** The two secrets that guard the Room, kept apart on purpose. */
export type Access = {
  /** Lets someone shape the Queue from their phone. */
  joinCode: string;
  /** Lets a device take the speaker. Never the same gate as the Join Code. */
  playerPassword: string;
};

export type Credentials = {
  role?: unknown;
  joinCode?: unknown;
  playerPassword?: unknown;
};

export type Admission = { ok: true; role: Role } | { ok: false; reason: string };

function required(env: Record<string, string | undefined>, name: string): string {
  const value = (env[name] ?? '').trim();
  if (!value) {
    throw new Error(
      `${name} is not set. The Room will not open without it: starting anyway would ` +
        `leave it unguarded to anyone who finds the address. See .env.example.`
    );
  }
  return value;
}

export function readAccess(env: Record<string, string | undefined>): Access {
  return {
    joinCode: required(env, 'JOIN_CODE'),
    playerPassword: required(env, 'PLAYER_PASSWORD')
  };
}

/**
 * Compares without letting the time taken say how much of the secret was right.
 * The Room is small and the stakes are low, but there is no reason to hand that
 * away when the correct comparison is this cheap.
 */
function matches(expected: string, offered: unknown): boolean {
  if (typeof offered !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(offered);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function admits(access: Access, credentials: Credentials): Admission {
  if (credentials.role === 'player') {
    return matches(access.playerPassword, credentials.playerPassword)
      ? { ok: true, role: 'player' }
      : { ok: false, reason: 'That password is not right.' };
  }

  if (credentials.role === 'controller') {
    return matches(access.joinCode, credentials.joinCode)
      ? { ok: true, role: 'controller' }
      : { ok: false, reason: 'That code is not right.' };
  }

  return { ok: false, reason: 'Say whether you are a phone or the speaker.' };
}
