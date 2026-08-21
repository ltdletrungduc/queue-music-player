import { describe, expect, it } from 'vitest';
import { evaluatePlayerScript, isVerdictAboutTheVideo } from './innertube.js';

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
