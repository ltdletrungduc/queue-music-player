import { describe, expect, it } from 'vitest';
import { createInnertube, innertubeLookup, innertubeStream } from './innertube.js';
import { createYouTubeProvider } from './youtube.js';

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

  it('opens a Stream that ends by itself', async () => {
    const provider = await realProvider();
    const validated = await provider.validate('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const stream = await provider.resolve(validated.song);
    expect(stream.contentType).toMatch(/^audio\//);

    // The Stream closing on its own is the point: SABR keeps asking for segments
    // long after the audio has all arrived, and a Stream that never ends means a
    // Track that never finishes.
    const reader = stream.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
    expect(bytes).toBeGreaterThan(100_000);
  }, 60_000);

  it('refuses a video that does not exist', async () => {
    const provider = await realProvider();
    const result = await provider.validate('https://www.youtube.com/watch?v=aaaaaaaaaaa');

    expect(result).toEqual({ ok: false, reason: "That video is private, deleted, or doesn't exist." });
  }, 30_000);
});
