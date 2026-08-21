import { describe, expect, it } from 'vitest';
import {
  endWhenTheAudioRunsOut,
  evaluatePlayerScript,
  isVerdictAboutTheVideo
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

describe('telling audio that ran out from audio that was cut off', () => {
  /**
   * A Stream that hands over each chunk and then fails the way SABR does.
   *
   * The chunks are served from `pull` rather than queued up front: erroring a
   * controller throws away whatever is already queued, so a stream built that
   * way would deliver nothing and every case would look like a failure.
   */
  const breaksAfter = (chunks: number[][]) => {
    let next = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (next < chunks.length) return void controller.enqueue(Uint8Array.from(chunks[next++]!));
        controller.error(new Error('No media parts or protocol updates received from server.'));
      }
    });
  };

  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    let delivered = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return delivered;
      delivered += value.length;
    }
  };

  it('ends quietly when every byte the format promised has arrived', async () => {
    const aborted: string[] = [];
    const stream = endWhenTheAudioRunsOut(breaksAfter([[1, 2, 3, 4]]), 4, () => aborted.push('x'));
    await expect(drain(stream)).resolves.toBe(4);
    expect(aborted).toHaveLength(1);
  });

  it('fails loudly when the Stream broke short of the promised length', async () => {
    const aborted: string[] = [];
    const stream = endWhenTheAudioRunsOut(breaksAfter([[1, 2]]), 100, () => aborted.push('x'));
    await expect(drain(stream)).rejects.toThrow(/No media parts/);
    // A cut-off Track must reach the Room's retry rather than look finished.
    expect(aborted).toHaveLength(1);
  });

  it('still trusts the bytes when no length was given', async () => {
    const stream = endWhenTheAudioRunsOut(breaksAfter([[1, 2, 3]]), undefined, () => {});
    await expect(drain(stream)).resolves.toBe(3);
  });

  it('fails when the Stream broke before any audio arrived', async () => {
    const stream = endWhenTheAudioRunsOut(breaksAfter([]), 100, () => {});
    await expect(drain(stream)).rejects.toThrow(/No media parts/);
  });
});
