import { describe, expect, it } from 'vitest';
import { endingOnlyWhenComplete } from './http-audio.js';

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
