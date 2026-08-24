import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Server as SocketServer } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddResult, RoomState, Song } from '@qmp/shared';
import { attachRealtime } from './realtime.js';
import { createRoomRuntime } from './room/room.js';
import { createMemoryRoomStore } from './persistence/memory-room-store.js';
import { fakeProvider } from './sources/fake-provider.js';

const access = { joinCode: 'let-me-in', playerPassword: 'the-speaker' };

const song: Song = {
  id: 'youtube:aaaaaaaaaaa',
  source: 'youtube',
  sourceId: 'aaaaaaaaaaa',
  title: 'A Song',
  author: 'Someone',
  durationSeconds: 213,
  artworkUrl: 'https://i.ytimg.test/a.jpg'
};

/** Every Track the snapshot knows about, wherever it happens to sit. */
const tracksIn = (room: RoomState) => [room.nowPlaying, ...room.queue, ...room.history];

let httpServer: HttpServer;
let io: SocketServer;
let room: Awaited<ReturnType<typeof createRoomRuntime>>;
let client: Socket;

beforeEach(async () => {
  room = await createRoomRuntime(createMemoryRoomStore(), { now: Date.now, newId: randomUUID });
  httpServer = createServer();
  io = new SocketServer(httpServer);
  attachRealtime(io, {
    room,
    access,
    sources: async () => [fakeProvider({ 'fake:good': song })],
    forgetSources: () => {},
    streamTickets: new Set()
  });

  const port = await new Promise<number>((ready) => {
    httpServer.listen(0, () => ready((httpServer.address() as AddressInfo).port));
  });

  client = connect(`http://localhost:${port}`, {
    auth: { role: 'controller', joinCode: access.joinCode }
  });
  await new Promise<void>((joined) => client.on('connect', () => joined()));
});

afterEach(async () => {
  client.close();
  await new Promise<void>((closed) => io.close(() => closed()));
  await room.close();
});

it('carries a Command over the socket into the reducer and a snapshot back out', async () => {
  // The Command reaches the reducer: the ack comes back with what was added.
  const acked = client.emitWithAck('track/add', 'fake:good') as Promise<AddResult>;

  // The snapshot comes back out: a `room` carrying the added Track is broadcast.
  const snapshot = new Promise<RoomState>((arrived) => {
    client.on('room', (state: RoomState) => {
      if (tracksIn(state).some((track) => track?.song.id === song.id)) arrived(state);
    });
  });

  expect(await acked).toEqual({ ok: true, song });
  expect(tracksIn(await snapshot).map((track) => track?.song.id)).toContain(song.id);
});
