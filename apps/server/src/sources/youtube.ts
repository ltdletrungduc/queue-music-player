import type { Song } from '@qmp/shared';
import type { SourceProvider, Validation } from './types.js';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const VIDEO_ID = /^[\w-]{11}$/;

/** The video a link points at, or null when the link is not a YouTube video. */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const candidate = SHORT_HOSTS.has(parsed.hostname)
    ? parsed.pathname.slice(1)
    : HOSTS.has(parsed.hostname)
      ? (parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/shorts\/([^/]+)/)?.[1] ?? '')
      : '';

  return VIDEO_ID.test(candidate) ? candidate : null;
}

/** What a Source can tell us about a video, or null when there is no such video. */
export type SongLookup = (videoId: string) => Promise<{
  title: string;
  author: string;
  /** Zero for a live broadcast; null when YouTube did not say. */
  durationSeconds: number | null;
  artworkUrl: string;
} | null>;

export function createYouTubeProvider(lookup: SongLookup): SourceProvider {
  return {
    matches: (url) => youtubeVideoId(url) !== null,

    async validate(url): Promise<Validation> {
      const videoId = youtubeVideoId(url);
      if (!videoId) return { ok: false, reason: "That doesn't look like a YouTube link." };

      let found: Awaited<ReturnType<SongLookup>>;
      try {
        found = await lookup(videoId);
      } catch {
        return { ok: false, reason: 'Could not reach YouTube. Try again.' };
      }

      if (!found) return { ok: false, reason: "That video is private, deleted, or doesn't exist." };
      if (found.durationSeconds === null) {
        return { ok: false, reason: "Couldn't read how long that video is." };
      }
      // YouTube reports a live broadcast as zero-length; there is no end to queue past.
      if (found.durationSeconds <= 0) return { ok: false, reason: 'Live streams cannot be queued.' };

      const song: Song = {
        id: `youtube:${videoId}`,
        source: 'youtube',
        sourceId: videoId,
        ...found,
        durationSeconds: found.durationSeconds
      };
      return { ok: true, song };
    }
  };
}
