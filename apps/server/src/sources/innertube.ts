import vm from 'node:vm';
import { Innertube, Misc, Platform } from 'youtubei.js';
import type { SongLookup, StreamLookup } from './youtube.js';

const EVAL_DEADLINE_MS = 5_000;

/**
 * The client whose player response still carries a URL per format.
 *
 * The web client's does not: it offers a single SABR endpoint, and SABR now
 * answers every request with `attestation pending` and stops sending audio a
 * couple of minutes in, whatever the video. See ADR-0002.
 */
const CLIENT_WITH_URLS = 'VISIONOS' as const;

/**
 * How much audio one request asks for.
 *
 * The size barely matters; asking for a range at all is the point, because
 * YouTube paces a single open-ended GET at roughly twice real time and does not
 * pace ranged requests at all. See ADR-0002.
 */
const RANGE_BYTES = 1 << 20;

/** Roughly what a good stereo stream costs, and plenty for a speaker in a room. */
const ABOUT_RIGHT_BITRATE = 128_000;

/**
 * How many times a range is re-asked for before the Song is called lost.
 *
 * An hour of audio is a long time for a connection to stay perfect, and a blip
 * costs one request to recover from. Giving up instead costs the Room the whole
 * Track, which restarts from the beginning.
 */
const RESUME_ATTEMPTS = 3;

/**
 * Runs YouTube's player script, which has to happen to decipher the streaming
 * endpoint — undeciphered it returns 403 — and which youtubei.js ships no
 * interpreter for.
 *
 * This is untrusted remote code. It gets a context containing nothing but the
 * variables it was handed, and a deadline; it never sees this process's scope.
 * See ADR-0002.
 */
export function evaluatePlayerScript(
  source: string,
  variables: Record<string, unknown> = {}
): unknown {
  const sandbox = Object.assign(Object.create(null), variables);
  return vm.runInNewContext(`(function(){${source}})()`, sandbox, { timeout: EVAL_DEADLINE_MS });
}

/** One session serves every lookup and every Stream; creating one costs a round trip. */
export function createInnertube(): Promise<Innertube> {
  Platform.shim.eval = async (data, env) => evaluatePlayerScript(data.output, env);
  return Innertube.create();
}

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
 * Asks YouTube what a video is.
 *
 * The original plan was YouTube's public oEmbed endpoint, which needs no key
 * and no quota. It does not report duration, which the Queue must show, so
 * InnerTube is used instead. If adding ever starts failing while playback still
 * works, oEmbed remains a sound fallback for everything except duration.
 */
export function innertubeLookup(youtube: Innertube): SongLookup {
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

/**
 * Opens one range of the audio. Separated out so the reading of it can be
 * tested without a network.
 */
export type RangeLookup = (start: number, end: number) => Promise<ReadableStream<Uint8Array>>;

/**
 * Reads the whole audio as one Stream, a range at a time.
 *
 * Ranges are asked for one after another rather than all at once: the Player
 * consumes at the speed of the music, and pulling an hour of audio ahead of it
 * would spend an hour of somebody's bandwidth on a Song that may be skipped in
 * ten seconds.
 *
 * The length the format promised is what says the audio is complete, and the
 * Stream ends only on reaching it.
 */
export function streamInRanges(
  openRange: RangeLookup,
  totalBytes: number,
  rangeBytes: number = RANGE_BYTES
): ReadableStream<Uint8Array> {
  let delivered = 0;
  let rangeEnd = -1;
  let current: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;
  /** Attempts since the last byte arrived, so a Song that is still moving is never given up on. */
  let fruitless = 0;

  return new ReadableStream<Uint8Array>({
    // Loops until it has something to hand over: a range ending is not an answer
    // to the Player's read, and returning without one stalls the Stream for
    // good, because nothing asks again.
    async pull(controller) {
      while (!cancelled) {
        try {
          if (!current) {
            if (delivered >= totalBytes) return controller.close();
            rangeEnd = Math.min(delivered + rangeBytes, totalBytes) - 1;
            current = (await openRange(delivered, rangeEnd)).getReader();
          }

          const { done, value } = await current.read();

          if (done) {
            current = undefined;
            if (delivered > rangeEnd) continue; // the whole range arrived; on to the next
            throw new Error(`The audio stopped short: ${delivered} of ${totalBytes} bytes`);
          }

          fruitless = 0;
          delivered += value.length;
          controller.enqueue(value);
          return;
        } catch (error) {
          // A range that fails or stops early is usually a blip, and the next
          // range simply starts from where the audio got to, so asking again
          // resumes rather than repeats.
          current = undefined;
          if (++fruitless > RESUME_ATTEMPTS) throw error;
        }
      }
    },

    async cancel(reason) {
      cancelled = true;
      await current?.cancel(reason).catch(() => {});
    }
  });
}

/**
 * What the speaker will play: the audio-only format nearest ABOUT_RIGHT_BITRATE.
 *
 * Formats carrying video are skipped — there is nothing to show, and the video
 * is most of the bytes. Of the rest the middle is wanted, not the best: it is a
 * speaker in a room, not headphones, and the highest quality is several times
 * the bandwidth for a difference nobody at the party will hear.
 *
 * Nearest-to-a-target rather than a quality label, because the label is optional
 * and a video that omits it would otherwise fall back to the most expensive
 * format there is — the opposite of what is wanted.
 */
export function chooseAudioFormat(formats: Misc.Format[]): Misc.Format | undefined {
  const distance = (format: Misc.Format) => Math.abs((format.bitrate ?? 0) - ABOUT_RIGHT_BITRATE);
  return formats
    .filter((format) => format.has_audio && !format.has_video)
    .sort((a, b) => distance(a) - distance(b))[0];
}

/**
 * Opens a Stream for a video.
 *
 * The bytes are pulled here and relayed to the Player rather than fetched by the
 * Player itself, because the media host only permits the YouTube origin. See
 * ADR-0002 for why that has to happen on this machine.
 */
export function innertubeStream(youtube: Innertube): StreamLookup {
  return async (videoId) => {
    const info = await youtube.getInfo(videoId, { client: CLIENT_WITH_URLS });
    const format = chooseAudioFormat(info.streaming_data?.adaptive_formats ?? []);

    // Without a length there is no way to tell a Song that ended from one that
    // was cut off, and no way to ask for a range either.
    if (!format?.content_length) {
      throw new Error('YouTube did not offer a stream for this video');
    }

    // Undeciphered the URL returns 403, and its throttling parameter has to be
    // unscrambled too or YouTube paces what it sends. Both are the player
    // script's doing; see evaluatePlayerScript.
    //
    // Asked without a player, decipher hands back the raw URL rather than
    // refusing, and the Song then fails later as an unexplained 403. Saying so
    // here is what makes that a session to reopen rather than a mystery.
    const player = youtube.session.player;
    if (!player) throw new Error('The YouTube session has no player to decipher with');

    const url = await format.decipher(player);

    const openRange: RangeLookup = async (start, end) => {
      const response = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
      if (!response.ok || !response.body) {
        throw new Error(`YouTube refused a range of the audio (${response.status})`);
      }
      return response.body;
    };

    return {
      body: streamInRanges(openRange, format.content_length),
      contentType: format.mime_type
    };
  };
}
