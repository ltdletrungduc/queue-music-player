import { describe, expect, it } from 'vitest';
import type { Song } from '@qmp/shared';
import { addTrackByUrl } from './add-track.js';
import { fakeProvider } from '../sources/fake-provider.js';
import type { SourceProvider } from '../sources/types.js';
import type { Command } from './types.js';

const song: Song = {
  id: 'youtube:aaaaaaaaaaa',
  source: 'youtube',
  sourceId: 'aaaaaaaaaaa',
  title: 'A Song',
  author: 'Someone',
  durationSeconds: 213,
  artworkUrl: 'https://i.ytimg.test/a.jpg'
};

const spy = () => {
  const commands: Command[] = [];
  return { commands, dispatch: (c: Command) => void commands.push(c) };
};

const providers: SourceProvider[] = [fakeProvider({ 'fake:good': song })];
const who = { controllerId: 'c1', nickname: 'Duc' };

describe('adding a Track by pasting a link', () => {
  it('puts the Song the link describes into the Queue', async () => {
    const { commands, dispatch } = spy();
    const result = await addTrackByUrl(providers, dispatch, { url: 'fake:good', ...who });

    expect(result).toEqual({ ok: true, song });
    expect(commands).toEqual([{ type: 'track/added', song, controllerId: 'c1', nickname: 'Duc' }]);
  });

  it('queues nothing when no Source recognises the link', async () => {
    const { commands, dispatch } = spy();
    const result = await addTrackByUrl(providers, dispatch, { url: 'https://example.test/x', ...who });

    expect(result).toEqual({ ok: false, reason: "That link isn't from anywhere we can play." });
    expect(commands).toEqual([]);
  });

  it('queues nothing when the Source refuses the link', async () => {
    const { commands, dispatch } = spy();
    const result = await addTrackByUrl(providers, dispatch, { url: 'fake:missing', ...who });

    expect(result).toEqual({ ok: false, reason: 'No such fake Song.' });
    expect(commands).toEqual([]);
  });

  it('hands the link to the Source that recognises it', async () => {
    const other: SourceProvider = {
      source: 'youtube',
      matches: () => false,
      validate: async () => {
        throw new Error('should never be asked');
      },
      resolve: async () => {
        throw new Error('should never be asked');
      }
    };
    const { dispatch } = spy();
    const result = await addTrackByUrl([other, ...providers], dispatch, { url: 'fake:good', ...who });
    expect(result.ok).toBe(true);
  });
});
