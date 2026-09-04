import type { Song } from '@qmp/shared';
import type { SourceProvider, Stream, Validation } from './types.js';

/**
 * The extensions a pasted link is recognised by.
 *
 * A link is claimed on its extension rather than on what a `HEAD` says, because
 * `matches` is synchronous and answers before anything is fetched — the split
 * between Sources has to be decidable from the text of the link alone. What the
 * host actually serves is checked in `validate`, where there is a request to
 * check it with.
 *
 * `.webm` and `.mp4` are left out deliberately: both carry video far more often
 * than audio, and a container that might be either is not an unambiguous claim.
 */
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.wav',
  '.wave'
]);

/** Types that are not `audio/*` but are served for audio all the same. */
const COULD_BE_AUDIO = new Set(['application/ogg', 'application/octet-stream']);

/** The audio file a link points at, or null when the link is not one. */
export function directAudioUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const dot = parsed.pathname.lastIndexOf('.');
  const extension = dot === -1 ? '' : parsed.pathname.slice(dot).toLowerCase();

  return AUDIO_EXTENSIONS.has(extension) ? parsed.toString() : null;
}

/**
 * Addresses the server will not fetch on a Controller's say-so.
 *
 * Unlike YouTube, this Source fetches whatever address was pasted, from the
 * machine standing in the room. Without this, anyone holding the Join Code could
 * aim that fetch at the home router or a cloud metadata endpoint and read the
 * answer back as a Song title.
 *
 * Written as a list rather than one long expression because it is read far more
 * often than it is run, and because the two gaps found in it so far were both
 * missing entries rather than wrong ones. Each line says what it keeps out.
 *
 * Written-out addresses are normalised before this sees them, so the decimal and
 * hexadecimal spellings of a loopback address (`2130706433`, `0x7f000001`,
 * `127.1`) all arrive as `127.0.0.1`. IPv6 keeps its brackets, hence the `\[?`.
 */
const PRIVATE_ADDRESSES = [
  /^localhost$/i,
  /\.local$/i, // the printer, the router, anything answering to Bonjour
  /^0\./i, // this host, by another name
  /^127\./i, // loopback
  /^10\./i, // private
  /^192\.168\./i, // private
  /^172\.(1[6-9]|2\d|3[01])\./i, // private
  /^169\.254\./i, // link-local, which is where cloud metadata lives
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./i, // carrier-grade NAT
  /^\[?::1\]?$/i, // loopback, in IPv6
  /^\[?::ffff:/i, // IPv4 mapped into IPv6, which does not normalise back
  /^\[?f[cd][0-9a-f]{2}:/i, // unique local, in IPv6
  /^\[?fe[89a-f][0-9a-f]:/i // link- and site-local, the IPv6 spelling of 169.254
];

/**
 * Whether an address is one nobody outside this network could have meant.
 *
 * Asked once when a link is pasted, and again at every hop of every fetch made
 * for it: a host that was fine when it was checked can still answer with a
 * redirect pointing somewhere that is not.
 *
 * It reads the address as written, and does not resolve names — so a hostname
 * pointing at a private address still gets through. Closing that means resolving
 * the name here and pinning the connection to the address that came back, which
 * is worth doing if this ever runs anywhere but a laptop at a party.
 */
export const isPrivateAddress = (hostname: string): boolean =>
  PRIVATE_ADDRESSES.some((pattern) => pattern.test(hostname));

/**
 * What reading the head of a file tells us about it, or null when there is no
 * such file. Throwing means the host could not be reached, which is a different
 * answer: one says pick another link, the other says try again.
 */
export type SongLookup = (url: string) => Promise<{
  /** What the host says it is serving. */
  contentType: string;
  /** Read from the file's own tags; empty when it carries none. */
  title: string;
  author: string;
  /** Null when the file's headers did not say how long it is. */
  durationSeconds: number | null;
} | null>;

/** Opens the audio at a URL. Separate from metadata: only the Player needs it. */
export type StreamLookup = (url: string) => Promise<Stream>;

/** The file's own name, tidied up, for a file that carries no title of its own. */
function nameFromUrl(url: URL): string {
  const last = decodeURIComponent(url.pathname).split('/').pop() ?? '';
  return last.slice(0, last.lastIndexOf('.')) || last;
}

export function createDirectUrlProvider(
  lookup: SongLookup,
  openStream: StreamLookup
): SourceProvider {
  return {
    source: 'url',
    matches: (url) => directAudioUrl(url) !== null,

    async validate(url): Promise<Validation> {
      const audioUrl = directAudioUrl(url);
      if (!audioUrl) return { ok: false, reason: "That doesn't look like a link to an audio file." };

      const host = new URL(audioUrl).hostname;
      // Checked again at every hop of every fetch, in http-audio.ts. This copy
      // is not redundant: it is what turns a pasted LAN address into a reason
      // that says so, rather than into a failed fetch reported as a bad moment.
      if (isPrivateAddress(host)) {
        return { ok: false, reason: "That link points inside this machine's own network." };
      }

      let found: Awaited<ReturnType<SongLookup>>;
      try {
        found = await lookup(audioUrl);
      } catch {
        return { ok: false, reason: `Could not reach ${host}. Try again.` };
      }

      // One reason for the whole family, as YouTube gives one for private,
      // deleted and never-existed alike: from out here they are the same answer.
      if (!found) {
        return { ok: false, reason: 'That file is missing, private, or the link has expired.' };
      }

      // A host that names a type has to name one that could be audio. Ogg is
      // named as an application type by everyone who serves it, and a host
      // saying octet-stream is saying nothing at all — plenty hand back every
      // download that way. Both are taken at the extension's word.
      const type = found.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
      if (type && !type.startsWith('audio/') && !COULD_BE_AUDIO.has(type)) {
        return {
          ok: false,
          reason:
            type === 'text/html'
              ? 'That link leads to a web page, not to audio.'
              : `That link serves ${type}, not audio.`
        };
      }

      const song: Song = {
        id: `url:${audioUrl}`,
        source: 'url',
        sourceId: audioUrl,
        title: found.title || nameFromUrl(new URL(audioUrl)),
        author: found.author || host,
        // Zero means unknown here rather than "live", as it does for YouTube: a
        // file whose length nothing reported still plays, and refusing it would
        // cost a perfectly good Song. It costs the progress bar, which sits at
        // 0:00 for the whole Track — nothing reports a length back, so the Room
        // never learns one it was not told at the outset.
        durationSeconds: found.durationSeconds ?? 0,
        // Nothing at the other end of a bare file URL offers artwork.
        artworkUrl: ''
      };
      return { ok: true, song };
    },

    resolve: (song) => openStream(song.sourceId)
  };
}
