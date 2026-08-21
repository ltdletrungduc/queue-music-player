import type { AddResult } from '@qmp/shared';
import type { SourceProvider } from '../sources/types.js';
import type { Command } from './types.js';

/**
 * Turns a pasted link into a Track. The Source is consulted here rather than in
 * the reducer, so that the reducer stays pure and never waits on a network.
 */
export async function addTrackByUrl(
  providers: SourceProvider[],
  dispatch: (command: Command) => void,
  request: { url: string; controllerId: string; nickname: string }
): Promise<AddResult> {
  const provider = providers.find((p) => p.matches(request.url));
  if (!provider) return { ok: false, reason: "That link isn't from anywhere we can play." };

  const validation = await provider.validate(request.url);
  if (!validation.ok) return validation;

  dispatch({
    type: 'track/added',
    song: validation.song,
    controllerId: request.controllerId,
    nickname: request.nickname
  });
  return { ok: true, song: validation.song };
}
