import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server as SocketServer } from 'socket.io';
import { createRoomRuntime } from './room/room.js';
import { attachRealtime } from './realtime.js';
import { openRoomStore } from './persistence/firestore-room-store.js';
import { createYouTubeProvider, youtubeVideoId } from './sources/youtube.js';
import { createDirectUrlProvider } from './sources/direct-url.js';
import { httpAudioLookup, httpAudioStream } from './sources/http-audio.js';
import {
  createInnertube,
  innertubeLookup,
  innertubeStream,
  isVerdictAboutTheVideo
} from './sources/innertube.js';
import type { SourceProvider } from './sources/types.js';
import { readAccess, readFirebaseConfig } from './access.js';
import { isFromThisMachine } from './local-only.js';

// Secrets live in .env, never in the repository. See .env.example.
try {
  process.loadEnvFile();
} catch {
  // Already in the environment, or there is no file — readAccess decides whether
  // that is survivable.
}

const access = readAccess(process.env);

const PORT = Number(process.env['PORT'] ?? 5858);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const store = openRoomStore(readFirebaseConfig(process.env));

/**
 * The Room is read before anything is served. If Firestore cannot be reached
 * the server stops here on purpose: coming up with an empty Room would show
 * everyone an empty Queue and then write that emptiness over the real one.
 *
 * Nothing after this point waits for Firestore. A connection that goes away
 * mid-night costs the record of the night, not the night — see ADR-0004.
 */
const room = await createRoomRuntime(store, { now: Date.now, newId: randomUUID }, {
  onError: (error) => console.error('Could not write the Room down; will try again.', error)
}).catch((error: unknown) => {
  console.error('Could not read the Room from Firestore, so the Room is not opening.', error);
  process.exit(1);
});

/**
 * A direct audio link needs no session and no set-up, so this one is made once
 * and stands for the whole night. Nothing about it can go stale, which is why it
 * is not part of what forgetSources throws away.
 */
const directUrl = createDirectUrlProvider(httpAudioLookup, httpAudioStream);

/**
 * YouTube, by contrast, is reached for on first use, not at startup: a Room
 * whose Queue is already saved should still come up when YouTube is
 * unreachable.
 */
let youtube: Promise<SourceProvider> | undefined;
const forgetSources = () => void (youtube = undefined);

/**
 * What speaks for YouTube when no session could be made.
 *
 * It still recognises a YouTube link, so that pasting one is answered with why
 * it cannot be played rather than with the Room claiming never to have heard of
 * YouTube — which is what a missing provider would say, and is both untrue and
 * no help.
 */
const youtubeIsUnreachable: SourceProvider = {
  source: 'youtube',
  matches: (url) => youtubeVideoId(url) !== null,
  validate: async () => ({ ok: false, reason: 'Could not reach YouTube. Try again.' }),
  resolve: async () => {
    throw new Error('There is no YouTube session to play from');
  }
};

/**
 * Everything the Room can play.
 *
 * YouTube failing to open costs YouTube links and nothing else: a direct link
 * needs no session, and waiting on one that will never come would make somebody
 * else's outage into this Room's. A session that could not be made is dropped
 * rather than kept, or every later paste would fail on the same stale refusal.
 */
const sources = async (): Promise<SourceProvider[]> => {
  try {
    const provider = await (youtube ??= createInnertube().then((yt) =>
      createYouTubeProvider(innertubeLookup(yt), innertubeStream(yt))
    ));
    return [provider, directUrl];
  } catch (error) {
    forgetSources();
    console.error('Could not open a YouTube session; only direct links will play.', error);
    return [youtubeIsUnreachable, directUrl];
  }
};

const app = Fastify({ logger: false });
app.get('/health', async () => ({ ok: true }));

/**
 * The built Controller is served from here, so the Room is one origin: one
 * address to put through a tunnel, one origin for the socket and the audio, and
 * no secure page reaching for an insecure one.
 *
 * Not while developing, where Vite serves the Controller on its own port — a
 * build left over from last time would otherwise be served here alongside it,
 * and it takes a while to work out why an edit changed nothing.
 */
const CLIENT_BUILD = fileURLToPath(new URL('../../web/build', import.meta.url));
if (process.env['NODE_ENV'] !== 'development' && existsSync(CLIENT_BUILD)) {
  await app.register(fastifyStatic, { root: CLIENT_BUILD });

  // adapter-static writes one page and lets the client route from there, so an
  // unknown path is usually a route rather than a mistake. Only usually: a
  // missing asset is a missing asset, and answering those with a page of HTML
  // turns a stale bundle into a mystery instead of a 404.
  app.setNotFoundHandler((request, reply) => {
    const looksLikeAPage =
      request.method === 'GET' &&
      !request.url.startsWith('/_app/') &&
      (request.headers.accept ?? '').includes('text/html');

    return looksLikeAPage
      ? reply.code(200).type('text/html').sendFile('index.html')
      : reply.code(404).send({ reason: 'Not here.' });
  });
}

/**
 * Tickets for the audio endpoint, one per Player connection.
 *
 * An audio element cannot send credentials, and a Song's id is little more than
 * where it came from, so an ungated endpoint would let anyone who found the
 * address stream anything through this machine's connection. Each admitted
 * Player is handed a throwaway ticket instead, which dies with its connection.
 * The password itself never travels in a URL.
 */
const streamTickets = new Set<string>();

/**
 * The Player's audio element pulls from here, whatever the Source. For YouTube
 * the bytes have to come this way, because the media host only permits the
 * YouTube origin and a browser cannot fetch them for itself (ADR-0002). For a
 * direct audio link they need not, and do anyway, so that the Player has one
 * address to play and one way for a Song to fail. See ADR-0005.
 */
app.get<{ Params: { songId: string }; Querystring: { ticket?: string } }>(
  '/stream/:songId',
  async (request, reply) => {
  // Audio is for the speaker, and the speaker is here. Serving it to anywhere
  // else would turn this machine's own connection into a relay for strangers.
  if (!isFromThisMachine(request.ip, request.headers)) {
    return reply.code(403).send({ reason: 'Audio does not leave this machine.' });
  }

  const ticket = request.query.ticket;
  if (typeof ticket !== 'string' || !streamTickets.has(ticket)) {
    return reply.code(401).send({ reason: 'This is the speaker\'s door, and it is shut.' });
  }

  const song = room.findSong(request.params.songId);
  if (!song) return reply.code(404).send({ reason: 'That Song is not in the Room.' });

  const provider = (await sources()).find((p) => p.source === song.source);
  if (!provider) return reply.code(404).send({ reason: 'Nothing here can play that Song.' });

  try {
    const stream = await provider.resolve(song);
    return reply
      .header('Content-Type', stream.contentType)
      .header('Cache-Control', 'no-store')
      .send(Readable.fromWeb(stream.body as Parameters<typeof Readable.fromWeb>[0]));
  } catch (error) {
    // A verdict about this one video says nothing about the session; anything
    // else might mean the session itself is spent. Only YouTube has a session to
    // spend, so a file server having a bad moment must not cost one.
    if (song.source === 'youtube' && !isVerdictAboutTheVideo(error)) forgetSources();
    request.log.error(error);
    return reply.code(502).send({ reason: 'Could not open that Song.' });
  }
  }
);

await app.listen({ port: PORT, host: HOST });

const io = new SocketServer(app.server, {
  // The client is served by Vite on its own port during development.
  cors: { origin: true }
});

attachRealtime(io, { room, access, sources, forgetSources, streamTickets });

/**
 * Writes are buffered, so the last one may still be in the air when somebody
 * presses Ctrl-C. Waiting briefly for it costs a moment at the end of the night
 * and saves whatever was added in the last second of it.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.race([
      room.close(),
      new Promise((done) => setTimeout(done, 2_000).unref())
    ]).then(() => process.exit(0));
  });
}

console.log(`server ready on http://${HOST}:${PORT}`);
