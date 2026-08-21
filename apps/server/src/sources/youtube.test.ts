import { describe, expect, it } from 'vitest';
import { createYouTubeProvider, youtubeVideoId } from './youtube.js';
import type { SongLookup } from './youtube.js';

describe('recognising a YouTube link', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ']
  ])('reads the video out of %s', (url, expected) => {
    expect(youtubeVideoId(url)).toBe(expected);
  });

  it.each([
    'https://soundcloud.com/artist/track',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/',
    'not a url at all',
    ''
  ])('refuses %s', (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });
});

const lookup =
  (result: Awaited<ReturnType<SongLookup>>): SongLookup =>
  async () =>
    result;

const found = {
  title: 'Never Gonna Give You Up',
  author: 'Rick Astley',
  durationSeconds: 213,
  artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
};

describe('validating a YouTube link', () => {
  it('describes the Song behind a good link', async () => {
    const provider = createYouTubeProvider(lookup(found));
    const result = await provider.validate('https://youtu.be/dQw4w9WgXcQ');

    expect(result).toEqual({
      ok: true,
      song: { id: 'youtube:dQw4w9WgXcQ', source: 'youtube', sourceId: 'dQw4w9WgXcQ', ...found }
    });
  });

  it('identifies the same Song by the same name whichever link form was pasted', async () => {
    const provider = createYouTubeProvider(lookup(found));
    const short = await provider.validate('https://youtu.be/dQw4w9WgXcQ');
    const long = await provider.validate('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9');

    expect(short.ok && short.song.id).toBe(long.ok && long.song.id);
  });

  it('refuses a link that is not YouTube at all', async () => {
    const provider = createYouTubeProvider(lookup(found));
    expect(await provider.validate('https://example.test/song')).toEqual({
      ok: false,
      reason: "That doesn't look like a YouTube link."
    });
  });

  it('refuses a video that is not there', async () => {
    const provider = createYouTubeProvider(lookup(null));
    expect(await provider.validate('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      ok: false,
      reason: "That video is private, deleted, or doesn't exist."
    });
  });

  it('refuses a video whose length YouTube did not report', async () => {
    const provider = createYouTubeProvider(lookup({ ...found, durationSeconds: null }));
    expect(await provider.validate('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      ok: false,
      reason: "Couldn't read how long that video is."
    });
  });

  it('refuses a live stream, which has no duration to queue', async () => {
    const provider = createYouTubeProvider(lookup({ ...found, durationSeconds: 0 }));
    const result = await provider.validate('https://youtu.be/dQw4w9WgXcQ');
    expect(result).toEqual({ ok: false, reason: 'Live streams cannot be queued.' });
  });

  it('says so plainly when the Source cannot be reached', async () => {
    const provider = createYouTubeProvider(async () => {
      throw new Error('socket hang up');
    });
    expect(await provider.validate('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      ok: false,
      reason: 'Could not reach YouTube. Try again.'
    });
  });
});
