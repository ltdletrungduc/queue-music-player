import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Fastify from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { createRoomRuntime } from './room/room.js';
import { openRoomStore } from './persistence/room-store.js';

const PORT = Number(process.env['PORT'] ?? 5858);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const DB_FILE = resolve(process.env['DB_FILE'] ?? join(process.cwd(), 'data', 'room.sqlite'));

mkdirSync(dirname(DB_FILE), { recursive: true });
const room = createRoomRuntime(openRoomStore(DB_FILE), { now: Date.now, newId: randomUUID });

const app = Fastify({ logger: false });
app.get('/health', async () => ({ ok: true }));

await app.listen({ port: PORT, host: HOST });

const io = new SocketServer(app.server, {
  // The client is served by Vite on its own port during development.
  cors: { origin: true }
});

function apply(effects: ReturnType<typeof room.dispatch>): void {
  for (const effect of effects) {
    if (effect.type === 'broadcast-snapshot') io.emit('room', room.snapshot());
  }
}

io.on('connection', (socket) => {
  const controllerId = String(socket.handshake.query['controllerId'] ?? socket.id);
  apply(room.dispatch({ type: 'controller/connected', controllerId }));
  socket.emit('room', room.snapshot());
  socket.on('disconnect', () => apply(room.dispatch({ type: 'controller/disconnected', controllerId })));
});

console.log(`server ready on http://${HOST}:${PORT}  (db: ${DB_FILE})`);
