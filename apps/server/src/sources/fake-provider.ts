import type { Song, SourceName } from '@qmp/shared';
import type { SourceProvider } from './types.js';

/**
 * Stands in for a real Source wherever behaviour is under test, so that no test
 * needs a network or a working YouTube.
 *
 * Which Source it speaks for, and which links it claims, are given rather than
 * fixed, so that a test can put two of them in a Room and watch a link go to the
 * right one — there is more than one Source now, and a link reaching the wrong
 * one is the way that goes wrong.
 */
export function fakeProvider(
  songs: Record<string, Song>,
  { source = 'youtube', claims = 'fake:' }: { source?: SourceName; claims?: string } = {}
): SourceProvider {
  return {
    source,
    matches: (url) => url.startsWith(claims),
    validate: async (url) => {
      const song = songs[url];
      return song ? { ok: true, song } : { ok: false, reason: 'No such fake Song.' };
    },

    resolve: async () => ({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
          controller.close();
        }
      }),
      contentType: 'audio/webm'
    })
  };
}
