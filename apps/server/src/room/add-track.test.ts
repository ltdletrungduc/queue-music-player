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

  /**
   * The Room has two Sources in it, and nothing above the providers decides
   * between them — whichever claims the link gets it. That is the whole of the
   * routing, so it is worth watching happen with both of them present rather
   * than only asking each one separately whether it would have claimed the link.
   */
  it('sends each link to the Source that claims it, with two to choose from', async () => {
    const fromAFile: Song = {
      ...song,
      id: 'url:https://example.test/a.mp3',
      source: 'url',
      sourceId: 'https://example.test/a.mp3'
    };
    const both: SourceProvider[] = [
      fakeProvider({ 'fake:good': song }),
      fakeProvider({ 'file:good': fromAFile }, { source: 'url', claims: 'file:' })
    ];

    const video = await addTrackByUrl(both, spy().dispatch, { url: 'fake:good', ...who });
    const file = await addTrackByUrl(both, spy().dispatch, { url: 'file:good', ...who });

    expect(video.ok && video.song.source).toBe('youtube');
    expect(file.ok && file.song.source).toBe('url');
  });

  it('still refuses a link neither Source claims', async () => {
    const both: SourceProvider[] = [
      fakeProvider({ 'fake:good': song }),
      fakeProvider({}, { source: 'url', claims: 'file:' })
    ];
    const { commands, dispatch } = spy();

    const result = await addTrackByUrl(both, dispatch, { url: 'https://example.test/x', ...who });
    expect(result).toEqual({ ok: false, reason: "That link isn't from anywhere we can play." });
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
