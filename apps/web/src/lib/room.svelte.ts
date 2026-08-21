import { io, type Socket } from 'socket.io-client';

/** Mirrors the server's Track. The server owns this shape; keep them in step. */
export type Track = {
  id: string;
  source: string;
  sourceId: string;
  orderKey: string;
  addedByControllerId: string;
  addedAt: number;
};

export type RoomState = {
  queue: Track[];
  controllers: { id: string; connectedAt: number }[];
};

const CONTROLLER_ID_KEY = 'qmp:controllerId';

/** Stable per-device identity, so a reload is the same Controller reconnecting. */
function controllerId(): string {
  const existing = localStorage.getItem(CONTROLLER_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(CONTROLLER_ID_KEY, fresh);
  return fresh;
}

/** Matches PORT in the server. */
const SERVER_PORT = 5858;

/**
 * The server runs on the same host the page came from, so a phone on the LAN
 * just works. Reaching the Room through a tunnel will need a configured origin
 * instead, since the tunnel terminates TLS on a port this does not know about.
 */
const serverUrl = () => `${location.protocol}//${location.hostname}:${SERVER_PORT}`;

export function createRoom() {
  let state = $state<RoomState>({ queue: [], controllers: [] });
  let connected = $state(false);
  let socket: Socket | undefined;

  function connect() {
    socket = io(serverUrl(), { query: { controllerId: controllerId() } });
    socket.on('connect', () => (connected = true));
    socket.on('disconnect', () => (connected = false));
    socket.on('room', (next: RoomState) => (state = next));
  }

  return {
    get queue() {
      return state.queue;
    },
    get controllerCount() {
      return state.controllers.length;
    },
    get connected() {
      return connected;
    },
    connect,
    disconnect: () => socket?.disconnect()
  };
}
