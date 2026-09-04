import { parseWebStream } from 'music-metadata';
import { isOnThisNetwork } from './direct-url.js';
import type { SongLookup, StreamLookup } from './direct-url.js';

/**
 * How much of a file is read to describe it.
 *
 * Tags and the headers that give a length live at the front, so this is
 * generous rather than exact — enough to clear a large embedded cover image and
 * still be a fraction of a Song. The rest is left unfetched; describing a link
 * somebody pasted should not cost them a download of it.
 */
const PROBE_BYTES = 512 * 1024;

/** How many redirects a link may take before it is treated as going nowhere. */
const REDIRECT_LIMIT = 5;

/**
 * Fetches a URL, refusing at every hop to touch this machine's own network.
 *
 * Redirects are followed by hand rather than left to `fetch`, which follows them
 * without asking. A host that is perfectly public can answer `302` pointing at
 * the home router or a metadata endpoint, and following that would walk straight
 * past the check made when the link was pasted — so every hop is checked, not
 * just the one somebody typed.
 *
 * Both the describing read and the playing read go through here, because a Song
 * saved in a Playlist is fetched again every night it is played, long after the
 * paste that admitted it.
 */
async function fetchOffThisNetwork(url: string, init: RequestInit): Promise<Response> {
  let target = url;

  for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`That link leads somewhere we cannot fetch (${parsed.protocol})`);
    }
    if (isOnThisNetwork(parsed.hostname)) {
      throw new Error("That link leads inside this machine's own network");
    }

    const response = await fetch(target, { ...init, redirect: 'manual' });

    const next = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !next) return response;

    await response.body?.cancel().catch(() => {});
    target = new URL(next, target).toString();
  }

  throw new Error('That link redirects more times than it should');
}

/** The whole file's length, which a partial response reports differently. */
function totalBytes(headers: Headers): number | undefined {
  const range = headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
  const length = range ?? headers.get('content-length');
  const size = Number(length);
  return length !== null && Number.isFinite(size) && size > 0 ? size : undefined;
}

/**
 * Reads the head of a file and says what it is.
 *
 * A length is asked of the file itself rather than of the host, because no
 * header carries one. For a constant-bitrate MP3 the answer comes from the
 * bitrate and the file's whole size, which is why that size is handed over even
 * though only the front of the file is read.
 */
export const httpAudioLookup: SongLookup = async (url) => {
  // The parser stops as soon as it has the headers it needs, well short of what
  // was asked for. Aborting is what closes the connection behind it — cancelling
  // the stream cannot, because the parser still holds the lock on it.
  const reading = new AbortController();

  try {
    const response = await fetchOffThisNetwork(url, {
      headers: { range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: reading.signal
    });

    // Anything the host blames on the request is a verdict about this link:
    // missing, private, or expired. Anything it blames on itself is a bad
    // moment, and is thrown so the Controller is told to try again.
    if (response.status >= 400 && response.status < 500) return null;
    if (!response.ok || !response.body) {
      throw new Error(`${new URL(url).hostname} answered ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';

    const size = totalBytes(response.headers);

    let metadata;
    try {
      metadata = await parseWebStream(
        response.body,
        {
          ...(contentType ? { mimeType: contentType } : {}),
          ...(size === undefined ? {} : { size })
        },
        // Only the front of the file is here, and the parser otherwise goes
        // looking for an ID3v1 tag in the last 128 bytes of it. Waiting on a
        // tail that will never arrive costs the length of a constant-bitrate
        // MP3, which is worked out from the bitrate and the size and is the
        // only length most files offer. A file tagged with nothing but ID3v1
        // loses its title to this, and is named after its file instead.
        { skipPostHeaders: true }
      );
    } catch {
      // A file whose tags cannot be read is still a file that plays. The link is
      // described by its own name and its host instead.
      return { contentType, title: '', author: '', durationSeconds: null };
    }

    const duration = metadata.format.duration;
    return {
      contentType,
      title: metadata.common.title ?? '',
      author: metadata.common.artist ?? '',
      durationSeconds: typeof duration === 'number' && duration > 0 ? Math.round(duration) : null
    };
  } finally {
    reading.abort();
  }
};

/**
 * Fails a Stream that ends before the host said it would.
 *
 * Closing it instead would hand the Player a truncated file it cannot tell from
 * a whole one, so it would report the Track finished and move on part way
 * through; failing is what reaches the Room's retry. The same reasoning, and the
 * same conclusion, as the length check on the YouTube side — see ADR-0002.
 */
export function endingOnlyWhenComplete(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let delivered = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        if (delivered < expectedBytes) {
          throw new Error(`The audio stopped short: ${delivered} of ${expectedBytes} bytes`);
        }
        return controller.close();
      }

      delivered += value.length;
      controller.enqueue(value);
    },

    cancel: (reason) => reader.cancel(reason)
  });
}

/**
 * Opens the whole file as one Stream.
 *
 * No ranges, unlike YouTube: the pacing that forces those is YouTube's own
 * doing (ADR-0002), and an ordinary file server sends what it is asked for as
 * fast as the connection allows.
 */
export const httpAudioStream: StreamLookup = async (url) => {
  const response = await fetchOffThisNetwork(url, {});
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`The host refused the audio (${response.status})`);
  }

  const expected = totalBytes(response.headers);

  return {
    // A host that did not say how long the file is leaves nothing to check
    // against, and the Song is taken as it comes.
    body: expected === undefined ? response.body : endingOnlyWhenComplete(response.body, expected),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream'
  };
};
