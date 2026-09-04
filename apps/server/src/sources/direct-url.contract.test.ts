import { describe, expect, it } from 'vitest';
import { createDirectUrlProvider } from './direct-url.js';
import { httpAudioLookup, httpAudioStream } from './http-audio.js';

/**
 * Checks a real file server still behaves the way the fake claims. Excluded from
 * the default run: it needs a network, and it fails when somebody else's host is
 * down rather than when this repo changes. Run with `pnpm test:contract`.
 */
const provider = createDirectUrlProvider(httpAudioLookup, httpAudioStream);

/** A long-standing public MP3, served with a real content type and a length. */
const SONG = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

/**
 * A missing file on a different host, because the one above answers a bad path
 * with a 500 — which is a host saying it broke, not a link that is wrong, and
 * is deliberately not treated the same way.
 */
const MISSING = 'https://upload.wikimedia.org/wikipedia/commons/0/00/no-such-song-here.ogg';

describe('a direct audio link, for real', () => {
  it('describes a file that exists', async () => {
    const result = await provider.validate(SONG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).toMatchObject({ id: `url:${SONG}`, source: 'url', sourceId: SONG });
    // This file carries an artist and no title, so it exercises both halves:
    // what the tags say, and the file's own name standing in for what they do not.
    expect(result.song.title).toBe('SoundHelix-Song-1');
    expect(result.song.author.length).toBeGreaterThan(0);
    // Roughly six minutes. Asserted as a range rather than a number, because the
    // point is that a length was read at all, not which encoder produced it.
    expect(result.song.durationSeconds).toBeGreaterThan(60);
    expect(result.song.durationSeconds).toBeLessThan(3_600);
  }, 30_000);

  it('plays it from beginning to end', async () => {
    const validated = await provider.validate(SONG);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.reason);

    const stream = await provider.resolve(validated.song);
    expect(stream.contentType).toMatch(/^audio\//);

    const reader = stream.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }

    // Audio is roughly a constant number of bytes a second, so the Song's own
    // length says about how many to expect. Well under the thinnest encoding
    // anybody ships, so falling short means the file stopped short.
    expect(bytes).toBeGreaterThan(validated.song.durationSeconds * 8_000);
  }, 120_000);

  it('refuses a file that is not there', async () => {
    expect(await provider.validate(MISSING)).toEqual({
      ok: false,
      reason: 'That file is missing, private, or the link has expired.'
    });
  }, 30_000);
});
