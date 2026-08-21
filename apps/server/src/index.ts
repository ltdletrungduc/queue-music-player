import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server as SocketServer } from 'socket.io';
import { createRoomRuntime } from './room/room.js';
import { addTrackByUrl } from './room/add-track.js';
import { openRoomStore } from './persistence/room-store.js';
import { createYouTubeProvider } from './sources/youtube.js';
import {
  createInnertube,
  innertubeLookup,
  innertubeStream,
  isVerdictAboutTheVideo
} from './sources/innertube.js';
import type { Effect } from './room/types.js';
import type { SourceProvider } from './sources/types.js';
import { randomBytes } from 'node:crypto';
import { admits, readAccess, type Role } from './access.js';
import { isFromThisMachine } from './local-only.js';
import type { AddResult, Song } from '@qmp/shared';

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
const DB_FILE = resolve(process.env['DB_FILE'] ?? join(process.cwd(), 'data', 'room.sqlite'));

mkdirSync(dirname(DB_FILE), { recursive: true });
const room = createRoomRuntime(openRoomStore(DB_FILE), { now: Date.now, newId: randomUUID });

/**
 * The Source is reached for on first use, not at startup: a Room whose Queue is
 * already saved should still come up when YouTube is unreachable, and the
 * provider already has something sensible to say when it cannot be reached.
 */
let providers: Promise<SourceProvider[]> | undefined;
const sources = () =>
  (providers ??= createInnertube().then((yt) => [
    createYouTubeProvider(innertubeLookup(yt), innertubeStream(yt))
  ]));
const forgetSources = () => void (providers = undefined);

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
 * An audio element cannot send credentials, and a Song's id is simply its
 * YouTube id, so an ungated endpoint would let anyone who found the address
 * stream anything through this machine's connection. Each admitted Player is
 * handed a throwaway ticket instead, which dies with its connection. The
 * password itself never travels in a URL.
 */
const streamTickets = new Set<string>();

/**
 * The Player's audio element pulls from here. The bytes come from the Extractor
 * rather than from YouTube directly, because YouTube serves audio over SABR and
 * no media element can speak it. See ADR-0002.
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
    // else might mean the session itself is spent.
    if (!isVerdictAboutTheVideo(error)) forgetSources();
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

function apply(effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.type === 'broadcast-snapshot') io.emit('room', room.snapshot());
    if (effect.type === 'broadcast-position') {
      io.emit('position', effect.trackId, effect.positionSeconds, effect.reportedAt);
    }
  }
}

/**
 * Nobody hears anything about the Room until they have shown they belong in it.
 * Refusing the connection outright, rather than letting it in and filtering
 * afterwards, means there is no path where a snapshot escapes to a stranger.
 */
io.use((socket, next) => {
  const admission = admits(access, socket.handshake.auth);
  if (!admission.ok) return next(new Error(admission.reason));

  // The speaker is a physical thing in a room, and only this machine is in it.
  // Letting a device elsewhere claim it would drag every byte of audio back out
  // through this machine's connection to reach a speaker nobody here can hear.
  if (
    admission.role === 'player' &&
    !isFromThisMachine(socket.handshake.address, socket.handshake.headers)
  ) {
    return next(new Error('Open the Player on the machine connected to the speaker.'));
  }

  socket.data.role = admission.role;
  next();
});

io.on('connection', (socket) => {
  const role = socket.data.role as Role;
  const query = socket.handshake.query;
  const controllerId = String(query['controllerId'] ?? socket.id);
  /**
   * The Player is not a person and has no Nickname, but every Transport action
   * is attributed, so it needs something to be attributed to. Naming it for
   * what it is beats letting it borrow a guest's name.
   */
  const nickname = role === 'player' ? 'The speaker' : String(query['nickname'] ?? 'Guest');

  // The Player is a speaker, not a person: it does not appear in the Room.
  // The connection's own id, so a reload cannot make its predecessor's death
  // look like its own.
  const connectionId = socket.id;

  if (role === 'controller') {
    apply(room.dispatch({ type: 'controller/connected', controllerId, connectionId, nickname }));
  } else {
    // One speaker means one Player, and two of them means the same Track twice,
    // slightly apart. A second arrival is nearly always this machine coming back
    // before the server has noticed the old socket die, so the newcomer takes
    // the speaker and the stale one is let go. Refusing the newcomer instead
    // would strand a Player that dropped on bad wifi and came straight back:
    // nothing could take the speaker until the dead socket timed out.
    for (const other of io.sockets.sockets.values()) {
      if (other.id === socket.id || other.data.role !== 'player') continue;
      other.emit('let-go', 'Another Player took the speaker.');
      other.disconnect(true);
    }
    apply(room.dispatch({ type: 'player/connected', connectionId }));
    const ticket = randomBytes(24).toString('base64url');
    streamTickets.add(ticket);
    socket.on('disconnect', () => streamTickets.delete(ticket));
    socket.emit('stream-ticket', ticket);
  }
  socket.emit('room', room.snapshot());

  /**
   * Came through the Join Code, and may therefore do everything a person in the
   * Room may do. Holding the Player password makes a device the speaker instead:
   * the two gates are separate, so neither does the other's job.
   */
  const isInTheRoom = role === 'controller';

  /**
   * Stopping, starting, moving on and the volume are what someone standing at
   * the speaker reaches for, and they belong to the Player alone. Shaping what
   * comes next — adding, reordering, removing — still belongs to the Join Code:
   * holding the Player password makes a device the speaker, not a member of the
   * Room. See ADR-0001.
   *
   * The buttons are gone from the Controller's screen and so is the permission.
   * A missing button is not a rule.
   */
  const drivesTheTransport = role === 'player';

  socket.on('track/add', async (url: unknown, ack?: (result: AddResult) => void) => {
    if (!isInTheRoom) return;
    const effects: Effect[] = [];
    let result: AddResult;
    try {
      result = await addTrackByUrl(
        await sources(),
        (command) => effects.push(...room.dispatch(command)),
        { url: typeof url === 'string' ? url : '', controllerId, nickname }
      );
    } catch {
      forgetSources();
      result = { ok: false, reason: 'Could not reach YouTube. Try again.' };
    }
    apply(effects);
    ack?.(result);
  });

  // Only the Player knows a Track has finished, and it must say which one:
  // a reconnecting Player can otherwise end a Track that already ended. Now that
  // the speaker has a gate of its own, only something through that gate may say
  // these things at all.
  socket.on('track/ended', (trackId: unknown) => {
    if (role !== 'player' || typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'track/ended', trackId }));
  });

  // Only the Player finds out that a Song will not open.
  socket.on('track/failed', (trackId: unknown, reason: unknown) => {
    if (role !== 'player' || typeof trackId !== 'string') return;
    apply(
      room.dispatch({
        type: 'track/failed',
        trackId,
        reason: typeof reason === 'string' && reason ? reason : 'That Song would not play.'
      })
    );
  });

  // Likewise for where the audio has reached: only the Player can know, and a
  // report naming a Track that has moved on would drag the progress bar backwards.
  socket.on('player/position', (trackId: unknown, positionSeconds: unknown) => {
    if (role !== 'player' || typeof trackId !== 'string' || typeof positionSeconds !== 'number') return;
    apply(room.dispatch({ type: 'player/position', trackId, positionSeconds }));
  });

  socket.on('track/moved', (trackId: unknown, afterTrackId: unknown) => {
    if (!isInTheRoom || typeof trackId !== 'string') return;
    if (afterTrackId !== null && typeof afterTrackId !== 'string') return;
    apply(room.dispatch({ type: 'track/moved', trackId, afterTrackId, nickname }));
  });

  socket.on('track/play-next', (trackId: unknown) => {
    if (!isInTheRoom || typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'track/play-next', trackId, nickname }));
  });

  socket.on('track/removed', (trackId: unknown) => {
    if (!isInTheRoom || typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'track/removed', trackId, nickname }));
  });

  socket.on(
    'playlist/track-saved',
    (playlistId: unknown, newPlaylistName: unknown, songId: unknown) => {
      if (!isInTheRoom || typeof songId !== 'string') return;
      if (playlistId !== null && typeof playlistId !== 'string') return;

      // The Song is taken from the Room, not from the caller: a Controller may
      // save what is here, not describe something that is not.
      const song: Song | undefined = room.findSong(songId);
      if (!song) return;

      apply(
        room.dispatch({
          type: 'playlist/track-saved',
          playlistId,
          newPlaylistName: typeof newPlaylistName === 'string' ? newPlaylistName : undefined,
          song,
          nickname
        })
      );
    }
  );

  socket.on('playlist/renamed', (playlistId: unknown, name: unknown) => {
    if (!isInTheRoom || typeof playlistId !== 'string' || typeof name !== 'string') return;
    apply(room.dispatch({ type: 'playlist/renamed', playlistId, name, nickname }));
  });

  socket.on('playlist/loaded', (playlistId: unknown) => {
    if (!isInTheRoom || typeof playlistId !== 'string') return;
    apply(room.dispatch({ type: 'playlist/loaded', playlistId, nickname }));
  });

  socket.on('transport/paused', () => {
    if (drivesTheTransport) apply(room.dispatch({ type: 'transport/paused', nickname }));
  });
  socket.on('transport/resumed', () => {
    if (drivesTheTransport) apply(room.dispatch({ type: 'transport/resumed', nickname }));
  });

  socket.on('transport/skipped', (trackId: unknown) => {
    if (!drivesTheTransport || typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'transport/skipped', trackId, nickname }));
  });

  socket.on('transport/previous', (trackId: unknown) => {
    if (!drivesTheTransport || typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'transport/previous', trackId, nickname }));
  });

  socket.on('transport/volume', (volume: unknown) => {
    if (!drivesTheTransport || typeof volume !== 'number' || Number.isNaN(volume)) return;
    apply(room.dispatch({ type: 'transport/volume', volume, nickname }));
  });

  socket.on('disconnect', () => {
    apply(
      room.dispatch(
        role === 'controller'
          ? { type: 'controller/disconnected', controllerId, connectionId }
          : { type: 'player/disconnected', connectionId }
      )
    );
  });
});

/**
 * SABR can close a stream it has already closed, throwing from one of its own
 * timers where no await of ours can catch it. Aborting the stream properly stops
 * this happening, but the library is not ours and one Song must not end the
 * party, so that one error is survivable.
 *
 * Deliberately narrow: anything else still brings the process down, because a
 * server carrying on in an unknown state is worse than one that restarts.
 */
const isSabrClosingATwiceClosedStream = (error: unknown): boolean =>
  error instanceof Error &&
  (error as NodeJS.ErrnoException).code === 'ERR_INVALID_STATE' &&
  (error.stack?.includes('SabrStream') ?? false);

process.on('uncaughtException', (error) => {
  if (!isSabrClosingATwiceClosedStream(error)) throw error;
  console.error('[extractor] a Stream closed itself twice; the Room is still up:', error.message);
});

console.log(`server ready on http://${HOST}:${PORT}  (db: ${DB_FILE})`);
