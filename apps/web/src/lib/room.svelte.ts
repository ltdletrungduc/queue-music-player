import { io, type Socket } from 'socket.io-client';
import type { AddResult, RoomState } from '@qmp/shared';

const CONTROLLER_ID_KEY = 'qmp:controllerId';
const NICKNAME_KEY = 'qmp:nickname';

/** Stable per-device identity, so a reload is the same Controller reconnecting. */
function controllerId(): string {
  const existing = localStorage.getItem(CONTROLLER_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(CONTROLLER_ID_KEY, fresh);
  return fresh;
}

/** Choosing a Nickname comes later; until then everyone is a guest. */
const nickname = () => localStorage.getItem(NICKNAME_KEY) ?? 'Guest';

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

    connect() {
      socket = io(serverUrl(), { query: { controllerId: controllerId(), nickname: nickname() } });
      socket.on('connect', () => (connected = true));
      socket.on('disconnect', () => (connected = false));
      socket.on('room', (next: RoomState) => (state = next));
    },

    disconnect: () => socket?.disconnect(),

    addTrack: (url: string): Promise<AddResult> =>
      new Promise((resolve) => {
        if (!socket) return resolve({ ok: false, reason: 'Not connected yet.' });
        socket.emit('track/add', url, resolve);
      })
  };
}
