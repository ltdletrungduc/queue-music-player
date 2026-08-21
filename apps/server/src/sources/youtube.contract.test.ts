import { describe, expect, it } from 'vitest';
import { createInnertubeLookup } from './innertube-lookup.js';
import { createYouTubeProvider } from './youtube.js';

/**
 * Checks the real YouTube still behaves the way the fake claims. Excluded from
 * the default run: it needs a network and a residential IP, and it fails when
 * YouTube changes rather than when this repo does. Run with `pnpm test:contract`.
 */
describe('YouTube, for real', () => {
  it('describes a video that exists', async () => {
    const provider = createYouTubeProvider(await createInnertubeLookup());
    const result = await provider.validate('https://www.youtube.com/watch?v=jNQXAC9IVRw');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).toMatchObject({ id: 'youtube:jNQXAC9IVRw', source: 'youtube' });
    expect(result.song.title.length).toBeGreaterThan(0);
    expect(result.song.author.length).toBeGreaterThan(0);
    expect(result.song.durationSeconds).toBeGreaterThan(0);
    expect(result.song.artworkUrl).toMatch(/^https:\/\//);
  }, 30_000);

  it('refuses a video that does not exist', async () => {
    const provider = createYouTubeProvider(await createInnertubeLookup());
    const result = await provider.validate('https://www.youtube.com/watch?v=aaaaaaaaaaa');

    expect(result).toEqual({ ok: false, reason: "That video is private, deleted, or doesn't exist." });
  }, 30_000);
});
