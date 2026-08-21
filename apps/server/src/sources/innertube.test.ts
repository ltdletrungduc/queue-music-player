import type { Misc } from 'youtubei.js';
import { describe, expect, it } from 'vitest';
import {
  chooseAudioFormat,
  evaluatePlayerScript,
  isVerdictAboutTheVideo,
  streamInRanges
} from './innertube.js';

describe('telling a bad video from a bad connection', () => {
  it('treats a playability answer as a verdict about the video', () => {
    const error = Object.assign(new Error('This video is unavailable'), {
      info: { status: 'ERROR', reason: 'This video is unavailable' }
    });
    expect(isVerdictAboutTheVideo(error)).toBe(true);
  });

  it.each([
    ['a dropped connection', new Error('socket hang up')],
    ['an error carrying no verdict', Object.assign(new Error('boom'), { info: null })],
    ['an error whose verdict has no status', Object.assign(new Error('boom'), { info: {} })],
    ['something thrown that is not an error', 'boom']
  ])('treats %s as a failure to reach YouTube', (_, error) => {
    expect(isVerdictAboutTheVideo(error)).toBe(false);
  });
});

describe('running YouTube\'s player script', () => {
  it('gives back what the script returns', () => {
    expect(evaluatePlayerScript('return 1 + 1;')).toBe(2);
  });

  it('hands the script the variables it was given', () => {
    expect(evaluatePlayerScript('return greeting + name;', { greeting: 'hello ', name: 'world' })).toBe(
      'hello world'
    );
  });

  it('keeps Node out of reach', () => {
    expect(evaluatePlayerScript('return typeof process;')).toBe('undefined');
    expect(evaluatePlayerScript('return typeof require;')).toBe('undefined');
  });

  it('keeps Node out of reach of a script that goes looking for it', () => {
    // The usual way out of a context: build a function through a constructor and
    // hope it runs somewhere richer. It does not; it runs back in here.
    expect(
      evaluatePlayerScript('return this.constructor.constructor("return typeof process")();')
    ).toBe('undefined');
    expect(evaluatePlayerScript('return Object.constructor("return typeof require")();')).toBe(
      'undefined'
    );
  });

  it('cannot reach a global defined out here', () => {
    (globalThis as Record<string, unknown>)['aSecret'] = 'do not leak';
    try {
      expect(() => evaluatePlayerScript('return aSecret;')).toThrow();
    } finally {
      delete (globalThis as Record<string, unknown>)['aSecret'];
    }
  });

  it('stops a script that will not finish', () => {
    expect(() => evaluatePlayerScript('while (true) {}')).toThrow(/timed out|script execution/i);
  }, 15_000);
});

describe('choosing what the speaker hears', () => {
  const format = (itag: number, bitrate: number, rest: Partial<Misc.Format> = {}) =>
    ({ itag, bitrate, has_audio: true, has_video: false, ...rest }) as Misc.Format;

  it('never picks a format carrying video', () => {
    const video = format(137, 130_000, { has_video: true });
    expect(chooseAudioFormat([video, format(140, 128_000)])?.itag).toBe(140);
  });

  it('leaves the highest quality alone and takes the middle', () => {
    expect(chooseAudioFormat([format(258, 384_000), format(140, 128_000)])?.itag).toBe(140);
  });

  it('leaves the thinnest alone too', () => {
    expect(chooseAudioFormat([format(139, 48_000), format(140, 128_000)])?.itag).toBe(140);
  });

  /**
   * The quality label is optional. Choosing by it and falling back to the best
   * would hand a video that omits it the most expensive format there is, which
   * is the opposite of what is wanted.
   */
  it('still takes the middle when no format says what quality it is', () => {
    const unlabelled = [format(139, 48_000), format(140, 128_000), format(258, 384_000)];
    expect(chooseAudioFormat(unlabelled)?.itag).toBe(140);
  });

  it('gives back nothing when the video offers no audio of its own', () => {
    expect(chooseAudioFormat([format(137, 130_000, { has_audio: false, has_video: true })])).toBeUndefined();
  });
});

describe('pulling the audio a range at a time', () => {
  const audio = (length: number) => Uint8Array.from({ length }, (_, i) => i % 251);

  /**
   * Stands in for YouTube answering a ranged request. `stopsEarlyOnce` has the
   * first range fall short of what it was asked for and the rest behave, which
   * is what a blip part way through a Song looks like.
   */
  const serving = (bytes: Uint8Array, stopsEarlyOnce = 0) => {
    const asked: string[] = [];
    const openRange = async (start: number, end: number) => {
      const shortBy = asked.length === 0 ? stopsEarlyOnce : 0;
      asked.push(`${start}-${end}`);
      const slice = bytes.subarray(start, end + 1 - shortBy);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          // Two pieces, because a real response arrives in more than one.
          const half = Math.ceil(slice.length / 2);
          if (half) controller.enqueue(slice.subarray(0, half));
          if (slice.length > half) controller.enqueue(slice.subarray(half));
          controller.close();
        }
      });
    };
    return { asked, openRange };
  };

  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const pieces: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Uint8Array.from(pieces);
      pieces.push(...value);
    }
  };

  it('hands over every byte, in order, and then ends', async () => {
    const bytes = audio(2_500);
    const { openRange } = serving(bytes);
    await expect(drain(streamInRanges(openRange, bytes.length, 1_000))).resolves.toEqual(bytes);
  });

  it('asks for the whole audio and not a byte past it', async () => {
    const bytes = audio(2_500);
    const { asked, openRange } = serving(bytes);
    await drain(streamInRanges(openRange, bytes.length, 1_000));
    expect(asked).toEqual(['0-999', '1000-1999', '2000-2499']);
  });

  it('is one request when the audio fits in one range', async () => {
    const bytes = audio(400);
    const { asked, openRange } = serving(bytes);
    await drain(streamInRanges(openRange, bytes.length, 1_000));
    expect(asked).toEqual(['0-399']);
  });

  it('picks up where the audio got to when a range stops early', async () => {
    const bytes = audio(2_500);
    const { asked, openRange } = serving(bytes, 200);
    // Every byte still arrives, in order.
    await expect(drain(streamInRanges(openRange, bytes.length, 1_000))).resolves.toEqual(bytes);
    // The second range starts at 800, where the first one stopped, rather than
    // at 1000 where it was supposed to reach. Nothing is asked for twice.
    expect(asked).toEqual(['0-999', '800-1799', '1800-2499']);
  });

  it('asks again for a range that could not be opened', async () => {
    const bytes = audio(400);
    const { openRange } = serving(bytes);
    let refusals = 2;
    const flaky = async (start: number, end: number) => {
      if (refusals-- > 0) throw new Error('YouTube refused a range of the audio (503)');
      return openRange(start, end);
    };
    await expect(drain(streamInRanges(flaky, bytes.length, 1_000))).resolves.toEqual(bytes);
  });

  /**
   * The rule that survives from the Stream this replaced: a Song that stopped
   * short must not look like one that finished. See streamInRanges for why.
   */
  it('fails loudly, rather than ending, once the audio stops coming altogether', async () => {
    // Answers, but with nothing in it — so asking again never gets anywhere.
    const openRange = async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        }
      });
    await expect(drain(streamInRanges(openRange, 2_500, 1_000))).rejects.toThrow(/stopped short/i);
  });

  it('gives up on a range that will not open at all', async () => {
    let tries = 0;
    const openRange = async () => {
      tries++;
      throw new Error('YouTube refused a range of the audio (403)');
    };
    await expect(drain(streamInRanges(openRange, 2_500, 1_000))).rejects.toThrow(/refused a range/);
    // Bounded: it does not sit there asking for ever.
    expect(tries).toBeLessThanOrEqual(5);
  });

  it('stops asking for more once the Player has gone away', async () => {
    const bytes = audio(5_000);
    const { asked, openRange } = serving(bytes);
    const reader = streamInRanges(openRange, bytes.length, 1_000).getReader();
    await reader.read();
    await reader.cancel('the Track was skipped');
    const askedByThen = asked.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toHaveLength(askedByThen);
    expect(askedByThen).toBeLessThan(5);
  });
});
