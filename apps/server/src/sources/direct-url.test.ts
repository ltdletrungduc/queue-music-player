import { describe, expect, it } from 'vitest';
import { createDirectUrlProvider, directAudioUrl } from './direct-url.js';
import type { AudioLookup } from './direct-url.js';
import { youtubeVideoId } from './youtube.js';

describe('recognising a direct audio link', () => {
  it.each([
    'https://example.test/songs/track.mp3',
    'http://example.test/track.MP3',
    'https://example.test/a/b/c.m4a',
    'https://example.test/track.ogg',
    'https://example.test/track.opus',
    'https://example.test/track.flac',
    'https://example.test/track.wav',
    'https://example.test/track.mp3?signature=abc',
    '  https://example.test/track.mp3  '
  ])('takes %s', (url) => {
    expect(directAudioUrl(url)).not.toBeNull();
  });

  it.each([
    ['a page', 'https://example.test/songs'],
    ['a video file', 'https://example.test/clip.mp4'],
    ['an extensionless path', 'https://example.test/track'],
    ['a bare dot', 'https://example.test/.'],
    ['a scheme we cannot fetch', 'file:///Users/someone/track.mp3'],
    ['nonsense', 'not a url at all'],
    ['nothing', '']
  ])('refuses %s', (_, url) => {
    expect(directAudioUrl(url)).toBeNull();
  });

  it('keeps the query, because a signed link is nothing without it', () => {
    expect(directAudioUrl('https://example.test/t.mp3?sig=abc')).toBe(
      'https://example.test/t.mp3?sig=abc'
    );
  });

  /**
   * The two providers must never both answer for one link. YouTube's own
   * recogniser is the other half of the claim, so both are asserted here.
   */
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ'
  ])('never answers for the YouTube link %s', (url) => {
    expect(directAudioUrl(url)).toBeNull();
    expect(youtubeVideoId(url)).not.toBeNull();
  });
});

const found = {
  contentType: 'audio/mpeg',
  title: 'Never Gonna Give You Up',
  author: 'Rick Astley',
  durationSeconds: 213
};

const lookup =
  (result: Awaited<ReturnType<AudioLookup>>): AudioLookup =>
  async () =>
    result;

const neverStreams = async () => {
  throw new Error('validating should never open a Stream');
};

const providerWith = (audio: AudioLookup) => createDirectUrlProvider(audio, neverStreams);

describe('validating a direct audio link', () => {
  it('describes the Song behind a good link', async () => {
    const provider = providerWith(lookup(found));
    const result = await provider.validate('https://example.test/rickroll.mp3');

    expect(result).toEqual({
      ok: true,
      song: {
        id: 'url:https://example.test/rickroll.mp3',
        source: 'url',
        sourceId: 'https://example.test/rickroll.mp3',
        title: 'Never Gonna Give You Up',
        author: 'Rick Astley',
        durationSeconds: 213,
        artworkUrl: ''
      }
    });
  });

  it('names the Song after its file when it carries no title of its own', async () => {
    const provider = providerWith(lookup({ ...found, title: '' }));
    const result = await provider.validate('https://example.test/songs/Blue%20Monday.mp3');

    expect(result.ok && result.song.title).toBe('Blue Monday');
  });

  it('credits the host when the file names no artist', async () => {
    const provider = providerWith(lookup({ ...found, author: '' }));
    const result = await provider.validate('https://example.test/track.mp3');

    expect(result.ok && result.song.author).toBe('example.test');
  });

  /**
   * A length that cannot be read is not a reason to refuse the Song: it plays
   * perfectly well, and the Player learns the real length when it opens it.
   */
  it('queues a Song whose length the file did not say', async () => {
    const provider = providerWith(lookup({ ...found, durationSeconds: null }));
    const result = await provider.validate('https://example.test/track.mp3');

    expect(result.ok && result.song.durationSeconds).toBe(0);
  });

  it('refuses a link that is not to an audio file at all', async () => {
    const provider = providerWith(lookup(found));
    expect(await provider.validate('https://example.test/songs')).toEqual({
      ok: false,
      reason: "That doesn't look like a link to an audio file."
    });
  });

  it('refuses a file that is not there', async () => {
    const provider = providerWith(lookup(null));
    expect(await provider.validate('https://example.test/track.mp3')).toEqual({
      ok: false,
      reason: "That file is missing, or the link has expired."
    });
  });

  it('refuses a link that turns out to serve a page rather than audio', async () => {
    const provider = providerWith(lookup({ ...found, contentType: 'text/html; charset=utf-8' }));
    expect(await provider.validate('https://example.test/track.mp3')).toEqual({
      ok: false,
      reason: 'That link leads to a web page, not to audio.'
    });
  });

  /**
   * A host that says nothing about the type is taken at the extension's word.
   * Plenty of file servers hand every download back as octet-stream, and
   * refusing those would rule out most of the links people actually paste.
   */
  it.each(['application/octet-stream', 'application/ogg', ''])(
    'accepts a file served as %s, which is not a claim that it is not audio',
    async (contentType) => {
      const provider = providerWith(lookup({ ...found, contentType }));
      expect((await provider.validate('https://example.test/track.ogg')).ok).toBe(true);
    }
  );

  it('says so plainly when the host cannot be reached', async () => {
    const provider = providerWith(async () => {
      throw new Error('socket hang up');
    });
    expect(await provider.validate('https://example.test/track.mp3')).toEqual({
      ok: false,
      reason: 'Could not reach example.test. Try again.'
    });
  });

  /**
   * Everything else here is about the link; this is about the machine. The
   * server fetches whatever URL is pasted, so without this a Controller could
   * use it to reach into the network the Player is sitting on.
   */
  it.each([
    'http://localhost:8080/track.mp3',
    'http://127.0.0.1/track.mp3',
    'http://[::1]/track.mp3',
    'http://192.168.1.1/track.mp3',
    'http://10.0.0.5/track.mp3',
    'http://172.16.0.1/track.mp3',
    'http://169.254.169.254/track.mp3',
    'http://printer.local/track.mp3'
  ])('refuses %s, which points back at this network', async (url) => {
    const provider = providerWith(lookup(found));
    expect(await provider.validate(url)).toEqual({
      ok: false,
      reason: 'That link points inside this machine\'s own network.'
    });
  });
});

describe('opening a direct audio link', () => {
  it('asks for the bytes at the Song\'s own URL', async () => {
    const asked: string[] = [];
    const provider = createDirectUrlProvider(lookup(found), async (url) => {
      asked.push(url);
      return { body: new ReadableStream<Uint8Array>(), contentType: 'audio/mpeg' };
    });

    const validated = await provider.validate('https://example.test/track.mp3');
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    await provider.resolve(validated.song);
    expect(asked).toEqual(['https://example.test/track.mp3']);
  });
});
