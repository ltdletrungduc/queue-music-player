import { afterEach, describe, expect, it, vi } from 'vitest';
import { endingOnlyWhenComplete, httpAudioLookup, httpAudioStream } from './http-audio.js';

const streamOf = (...chunks: number[][]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    }
  });

/** Reads a Stream to its end, and says how many bytes came out. */
const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.length;
  }
};

describe('reading a Song that may stop short', () => {
  it('hands over every byte of a whole file', async () => {
    const stream = endingOnlyWhenComplete(streamOf([1, 2, 3], [4, 5]), 5);
    expect(await readAll(stream)).toBe(5);
  });

  /**
   * The Player cannot tell a truncated file from a whole one, so a Stream that
   * closed early would be heard as a Song that simply ended — and the Room would
   * move on part way through it. Failing is what reaches the retry instead.
   */
  it('fails a file that ended early rather than closing', async () => {
    const stream = endingOnlyWhenComplete(streamOf([1, 2, 3]), 10);
    await expect(readAll(stream)).rejects.toThrow('The audio stopped short: 3 of 10 bytes');
  });

  it('accepts a file the host under-promised', async () => {
    const stream = endingOnlyWhenComplete(streamOf([1, 2, 3, 4]), 3);
    expect(await readAll(stream)).toBe(4);
  });
});

/**
 * Answers a fetch with a redirect, then with a plain file, so the walk between
 * them can be watched without a network. Each entry is one hop.
 */
const hosting = (...answers: (readonly [number, string])[]) => {
  const asked: string[] = [];
  let hop = 0;

  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    const answer = answers[hop++];
    if (!answer) throw new Error(`nothing left to answer ${url} with`);

    const [status, location] = answer;
    return new Response(status >= 300 && status < 400 ? null : new Uint8Array([1, 2, 3]), {
      status,
      headers: status >= 300 && status < 400 ? { location } : { 'content-type': 'audio/mpeg' }
    });
  });

  return asked;
};

afterEach(() => vi.unstubAllGlobals());

/**
 * The address is checked when a link is pasted, but `fetch` follows redirects
 * without asking — so a host that is perfectly public can answer with one
 * pointing at the home router. Every hop is walked by hand and checked, and
 * these are the walk.
 */
describe('following a link that redirects', () => {
  it('refuses a public host that points at this network', async () => {
    hosting([302, 'http://169.254.169.254/secrets.mp3']);

    await expect(httpAudioStream('https://example.test/track.mp3')).rejects.toThrow(
      "inside this machine's own network"
    );
  });

  it('refuses one that arrives there by a roundabout route', async () => {
    hosting([302, 'https://elsewhere.test/a.mp3'], [302, 'http://[fe80::1]/a.mp3']);

    await expect(httpAudioStream('https://example.test/track.mp3')).rejects.toThrow(
      "inside this machine's own network"
    );
  });

  it('follows a redirect that does lead somewhere public', async () => {
    const asked = hosting([302, 'https://cdn.test/a.mp3'], [200, '']);

    const stream = await httpAudioStream('https://example.test/track.mp3');
    expect(stream.contentType).toBe('audio/mpeg');
    expect(asked).toEqual(['https://example.test/track.mp3', 'https://cdn.test/a.mp3']);
  });

  it('reads a relative redirect against the link it came from', async () => {
    const asked = hosting([302, '/moved/a.mp3'], [200, '']);

    await httpAudioStream('https://example.test/songs/track.mp3');
    expect(asked[1]).toBe('https://example.test/moved/a.mp3');
  });

  it('gives up on a link that goes round in circles', async () => {
    hosting(...Array.from({ length: 12 }, () => [302, 'https://example.test/track.mp3'] as const));

    await expect(httpAudioStream('https://example.test/track.mp3')).rejects.toThrow(
      'redirects more times than it should'
    );
  });
});

/**
 * A host has more ways to say no than "there is no such file", and only one of
 * them is about the file. Reading a refused `Range` as a missing Song would tell
 * whoever pasted it something confidently untrue.
 */
describe('telling a missing file from a refused request', () => {
  const answering = (status: number) =>
    vi.stubGlobal('fetch', async () => new Response(null, { status }));

  it.each([401, 403, 404, 410])('reads %i as there being no file to play', async (status) => {
    answering(status);
    await expect(httpAudioLookup('https://example.test/track.mp3')).resolves.toBeNull();
  });

  it.each([405, 416, 429])('reads %i as the host refusing, not the file missing', async (status) => {
    answering(status);
    await expect(httpAudioLookup('https://example.test/track.mp3')).rejects.toThrow(
      String(status)
    );
  });
});

/**
 * The paste-time refusal is not enough on its own. A Song saved in a Playlist is
 * opened again every night it is played, and by then nobody is checking the link
 * — so the refusal lives with the fetch, where both reads pass through it.
 *
 * Neither of these reaches the network: refusing happens before the request.
 */
describe('refusing to fetch this machine\'s own network', () => {
  it.each([
    'http://127.0.0.1:9/track.mp3',
    'http://169.254.169.254/track.mp3',
    'http://192.168.0.1/track.mp3'
  ])('will not describe %s', async (url) => {
    await expect(httpAudioLookup(url)).rejects.toThrow("inside this machine's own network");
  });

  it.each([
    'http://127.0.0.1:9/track.mp3',
    'http://169.254.169.254/track.mp3'
  ])('will not play %s', async (url) => {
    await expect(httpAudioStream(url)).rejects.toThrow("inside this machine's own network");
  });
});
