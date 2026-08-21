import { Innertube } from 'youtubei.js';
import type { SongLookup } from './youtube.js';

/**
 * YouTube reports an unwatchable video by throwing, with the playability answer
 * attached. That is a verdict about the video, not a failure to reach YouTube,
 * and the two must not be confused: one means "pick another link", the other
 * means "try again".
 */
export function isVerdictAboutTheVideo(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'info' in error &&
    typeof (error as { info?: unknown }).info === 'object' &&
    (error as { info: { status?: unknown } }).info !== null &&
    typeof (error as { info: { status?: unknown } }).info.status === 'string'
  );
}

/**
 * Asks YouTube what a video is. One InnerTube session is reused for every
 * lookup: creating one costs a round trip, and adding a Track should feel
 * immediate.
 *
 * The original plan was YouTube's public oEmbed endpoint, which needs no key
 * and no quota. It does not report duration, which the Queue must show, so
 * InnerTube is used instead. The cost is that adding a Track now depends on the
 * same machinery as playing one, and inherits the bot-verification risk in
 * ADR-0002. If adding starts failing while playback still works, oEmbed remains
 * a sound fallback for everything except duration.
 */
export async function createInnertubeLookup(): Promise<SongLookup> {
  const youtube = await Innertube.create();

  return async (videoId) => {
    let info;
    try {
      info = await youtube.getBasicInfo(videoId);
    } catch (error) {
      if (isVerdictAboutTheVideo(error)) return null;
      throw error;
    }

    if (info.playability_status?.status !== 'OK') return null;

    const basic = info.basic_info;
    return {
      title: basic.title ?? 'Unknown title',
      author: basic.author ?? 'Unknown',
      durationSeconds: basic.duration ?? null,
      artworkUrl: basic.thumbnail?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };
  };
}
