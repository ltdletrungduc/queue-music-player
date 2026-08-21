import vm from 'node:vm';
import { Innertube, Misc, Platform } from 'youtubei.js';
import { SabrStream } from 'googlevideo/sabr-stream';
import type { SabrFormat } from 'googlevideo/shared-types';
import type { SongLookup, StreamLookup } from './youtube.js';

const EVAL_DEADLINE_MS = 5_000;

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
 * SABR delivers every byte of the audio and then keeps asking for more, retrying
 * for the best part of a minute before giving up. Left alone it never closes the
 * stream, so the Player's audio element waits forever a second from the end and
 * never reports the Track as finished.
 *
 * The chosen format says how many bytes the audio is, so that is the end.
 */
function endWhenTheAudioRunsOut(
  source: ReadableStream<Uint8Array>,
  expectedBytes: number | undefined
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let delivered = 0;
  let finished = false;

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finished) return;
    finished = true;
    controller.close();
    // SABR is still mid-retry and will reject; nobody is waiting on it any more.
    void reader.cancel().catch(() => {});
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;

      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        // This is how the audio running out usually announces itself, and when
        // the length was unknown it is the only way we find out. Bytes already
        // delivered are a complete Song; no bytes at all is a real failure.
        if (delivered > 0) return finish(controller);
        finished = true;
        controller.error(error);
        return;
      }

      if (chunk.done || !chunk.value) return finish(controller);

      delivered += chunk.value.length;
      controller.enqueue(chunk.value);
      if (expectedBytes !== undefined && delivered >= expectedBytes) finish(controller);
    },

    cancel(reason) {
      finished = true;
      void reader.cancel(reason).catch(() => {});
    }
  });
}

/**
 * SABR describes a format with the same facts youtubei.js does, under different
 * names. Absent facts are left out rather than filled in, so that "YouTube did
 * not say" never arrives as a made-up value.
 */
function toSabrFormat(format: Misc.Format): SabrFormat {
  const optional = {
    width: format.width,
    height: format.height,
    contentLength: format.content_length,
    isDrc: format.is_drc,
    audioQuality: format.audio_quality,
    language: format.language
  };

  return {
    itag: format.itag,
    lastModified: format.last_modified_ms,
    approxDurationMs: format.approx_duration_ms,
    xtags: format.xtags ?? '',
    mimeType: format.mime_type,
    bitrate: format.bitrate,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined))
  };
}

/**
 * Opens a Stream for a video.
 *
 * YouTube serves audio over SABR: there is no per-format URL a media element
 * could fetch, so the bytes are pulled here and relayed to the Player. See
 * ADR-0002 for why that has to happen on this machine.
 */
export function innertubeStream(youtube: Innertube): StreamLookup {
  return async (videoId) => {
    const info = await youtube.getInfo(videoId);
    const streaming = info.streaming_data;
    const abrUrl = streaming?.server_abr_streaming_url;
    const ustreamerConfig =
      info.player_config?.media_common_config?.media_ustreamer_request_config
        ?.video_playback_ustreamer_config;

    if (!abrUrl || !ustreamerConfig) throw new Error('YouTube did not offer a stream for this video');

    const sabr = new SabrStream({
      formats: streaming.adaptive_formats.map(toSabrFormat),
      serverAbrStreamingUrl: await youtube.session.player!.decipher(abrUrl),
      videoPlaybackUstreamerConfig: ustreamerConfig,
      durationMs: (info.basic_info.duration ?? 0) * 1_000,
      clientInfo: { clientName: 1, clientVersion: '2.20240726.00.00' }
    });

    const { audioStream, selectedFormats } = await sabr.start({
      audioQuality: 'AUDIO_QUALITY_MEDIUM',
      enabledTrackTypes: 1 // audio only; there is nothing to show
    });

    return {
      body: endWhenTheAudioRunsOut(audioStream, selectedFormats?.audioFormat?.contentLength),
      contentType: selectedFormats?.audioFormat?.mimeType ?? 'audio/webm'
    };
  };
}
