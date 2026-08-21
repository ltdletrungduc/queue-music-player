import { describe, expect, it } from 'vitest';
import { isVerdictAboutTheVideo } from './innertube-lookup.js';

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
