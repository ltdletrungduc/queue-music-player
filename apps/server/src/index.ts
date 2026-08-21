import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import Fastify from 'fastify';
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
import type { AddResult } from '@qmp/shared';

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
 * The Player's audio element pulls from here. The bytes come from the Extractor
 * rather than from YouTube directly, because YouTube serves audio over SABR and
 * no media element can speak it. See ADR-0002.
 */
app.get<{ Params: { songId: string } }>('/stream/:songId', async (request, reply) => {
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
});

await app.listen({ port: PORT, host: HOST });

const io = new SocketServer(app.server, {
  // The client is served by Vite on its own port during development.
  cors: { origin: true }
});

function apply(effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.type === 'broadcast-snapshot') io.emit('room', room.snapshot());
  }
}

io.on('connection', (socket) => {
  const query = socket.handshake.query;
  const controllerId = String(query['controllerId'] ?? socket.id);
  const nickname = String(query['nickname'] ?? 'Guest');

  apply(room.dispatch({ type: 'controller/connected', controllerId, nickname }));
  socket.emit('room', room.snapshot());

  socket.on('track/add', async (url: unknown, ack?: (result: AddResult) => void) => {
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
  // a reconnecting Player can otherwise end a Track that already ended.
  socket.on('track/ended', (trackId: unknown) => {
    if (typeof trackId !== 'string') return;
    apply(room.dispatch({ type: 'track/ended', trackId }));
  });

  socket.on('disconnect', () => apply(room.dispatch({ type: 'controller/disconnected', controllerId })));
});

console.log(`server ready on http://${HOST}:${PORT}  (db: ${DB_FILE})`);
