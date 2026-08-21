import { describe, expect, it } from 'vitest';
import { createInnertube, innertubeLookup, innertubeStream } from './innertube.js';
import { createYouTubeProvider } from './youtube.js';
import type { SourceProvider } from './types.js';

/**
 * Checks the real YouTube still behaves the way the fake claims. Excluded from
 * the default run: it needs a network and a residential IP, and it fails when
 * YouTube changes rather than when this repo does. Run with `pnpm test:contract`.
 */
/** One session, as in the running server: creating one costs a round trip. */
const realProvider = async () => {
  const youtube = await createInnertube();
  return createYouTubeProvider(innertubeLookup(youtube), innertubeStream(youtube));
};

describe('YouTube, for real', () => {
  it('describes a video that exists', async () => {
    const provider = await realProvider();
    const result = await provider.validate('https://www.youtube.com/watch?v=jNQXAC9IVRw');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).toMatchObject({ id: 'youtube:jNQXAC9IVRw', source: 'youtube' });
    expect(result.song.title.length).toBeGreaterThan(0);
    expect(result.song.author.length).toBeGreaterThan(0);
    expect(result.song.durationSeconds).toBeGreaterThan(0);
    expect(result.song.artworkUrl).toMatch(/^https:\/\//);
  }, 30_000);

  /**
   * Reads a Stream to its end, keeping none of it. The count is the point: a
   * Song that stopped short is the failure this Source exists to have fixed.
   */
  const play = async (stream: Awaited<ReturnType<SourceProvider['resolve']>>) => {
    const reader = stream.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes += value.length;
    }
  };

  /**
   * Audio is roughly a constant number of bytes a second, so a Song's length
   * says about how many to expect. Well under the thinnest format YouTube
   * offers, so falling below it means the Song stopped short rather than that
   * it was encoded small.
   */
  const enoughBytesFor = (durationSeconds: number) => durationSeconds * 8_000;

  const streamOf = async (url: string) => {
    const provider = await realProvider();
    const validated = await provider.validate(url);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.reason);
    return { stream: await provider.resolve(validated.song), song: validated.song };
  };

  /**
   * Several Songs, and long ones, because the failure this replaced only showed
   * itself a couple of minutes in — anything shorter passed while the Extractor
   * was thoroughly broken.
   */
  it.each([
    ['a short one', 'jNQXAC9IVRw'],
    ['a song', 'dQw4w9WgXcQ'],
    ['an hour and a bit', 'zoK1swTBKXc']
  ])('plays %s from beginning to end', async (_, videoId) => {
    const { stream, song } = await streamOf(`https://www.youtube.com/watch?v=${videoId}`);
    expect(stream.contentType).toMatch(/^audio\//);

    // Reading to the end without throwing is half the claim; the other half is
    // that what arrived is the whole Song.
    const bytes = await play(stream);
    expect(bytes).toBeGreaterThan(enoughBytesFor(song.durationSeconds));
  }, 300_000);

  it('refuses a video that does not exist', async () => {
    const provider = await realProvider();
    const result = await provider.validate('https://www.youtube.com/watch?v=aaaaaaaaaaa');

    expect(result).toEqual({ ok: false, reason: "That video is private, deleted, or doesn't exist." });
  }, 30_000);
});
