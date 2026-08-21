import type { Song } from '@qmp/shared';
import type { SourceProvider } from './types.js';

/**
 * Stands in for a real Source wherever behaviour is under test, so that no test
 * needs a network or a working YouTube.
 */
export function fakeProvider(songs: Record<string, Song>): SourceProvider {
  return {
    matches: (url) => url.startsWith('fake:'),
    validate: async (url) => {
      const song = songs[url];
      return song ? { ok: true, song } : { ok: false, reason: 'No such fake Song.' };
    }
  };
}
