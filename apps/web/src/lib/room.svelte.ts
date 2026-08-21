import { io, type Socket } from 'socket.io-client';
import { emptyRoom } from '@qmp/shared';
import type { AddResult, RoomState } from '@qmp/shared';

const CONTROLLER_ID_KEY = 'qmp:controllerId';
const NICKNAME_KEY = 'qmp:nickname';
const JOIN_CODE_KEY = 'qmp:joinCode';

/** How someone gets into the Room: as a phone, or as the speaker. */
export type Entry =
  | { role: 'controller'; joinCode: string; nickname: string }
  | { role: 'player'; playerPassword: string };

/** Outside the door, waiting at it, or in. */
export type Standing = 'outside' | 'knocking' | 'inside';

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

/**
 * What this device was let in with last time, so nobody types it twice.
 *
 * The Player's password is deliberately not among them. Remembering it would
 * hand the speaker to whoever next opens that page on the host's laptop, and
 * the Player is opened once an evening, not once a glance.
 */
export function remembered() {
  return {
    joinCode: localStorage.getItem(JOIN_CODE_KEY) ?? '',
    nickname: localStorage.getItem(NICKNAME_KEY) ?? ''
  };
}

export function createRoom() {
  let state = $state<RoomState>(emptyRoom());
  let standing = $state<Standing>('outside');
  let refusal = $state<string | null>(null);
  let streamTicket = $state<string | null>(null);
  /**
   * Whether this device has ever been let in. Once it has, a dropped connection
   * is a hiccup to wait out, not a reason to send everyone back to the door and
   * make them find the code again in the middle of a party.
   */
  let admitted = $state(false);
  /**
   * When this device heard the Player's latest position report. The Player's own
   * clock is not this device's clock, and phones disagree by minutes, so elapsed
   * time is measured from arrival here rather than from a timestamp made there.
   */
  let positionHeardAt = $state(0);
  let socket: Socket | undefined;

  return {
    get queue() {
      return state.queue;
    },
    get nowPlaying() {
      return state.nowPlaying;
    },
    get history() {
      return state.history;
    },
    get controllerCount() {
      return state.controllers.length;
    },
    get transport() {
      return state.transport;
    },
    get lastAction() {
      return state.lastAction;
    },
    get positionHeardAt() {
      return positionHeardAt;
    },
    get standing() {
      return standing;
    },
    /** Has been let in at least once, whatever the connection is doing now. */
    get admitted() {
      return admitted;
    },
    get connected() {
      return standing === 'inside';
    },
    /** Why the door did not open, in words worth showing someone. */
    get refusal() {
      return refusal;
    },

    enter(entry: Entry) {
      socket?.disconnect();
      standing = 'knocking';
      refusal = null;

      // Credentials travel as auth, not as query: the server refuses the
      // connection outright rather than letting it open and filtering after.
      socket = io(serverUrl(), {
        auth: entry,
        query:
          entry.role === 'controller'
            ? { controllerId: controllerId(), nickname: entry.nickname }
            : { controllerId: 'the-player' }
      });

      socket.on('connect', () => {
        standing = 'inside';
        admitted = true;
        refusal = null;
        if (entry.role === 'controller') {
          localStorage.setItem(JOIN_CODE_KEY, entry.joinCode);
          localStorage.setItem(NICKNAME_KEY, entry.nickname);
        }
      });

      socket.on('stream-ticket', (ticket: string) => (streamTicket = ticket));

      socket.on('connect_error', (error: Error) => {
        // Being turned away is final; the wifi hiccuping is not. Socket.IO says
        // which by whether it means to try again — and treating a hiccup as a
        // refusal would throw everyone back to the door, mid-party, and stop the
        // client ever reconnecting on its own.
        if (socket?.active) {
          standing = 'knocking';
          return;
        }
        standing = 'outside';
        admitted = false;
        refusal = error.message || 'Could not reach the Room.';
      });

      socket.on('disconnect', (reason: string) => {
        if (reason === 'io client disconnect') return;
        standing = 'knocking';
      });

      socket.on('room', (next: RoomState) => {
        if (next.transport.positionReportedAt !== state.transport.positionReportedAt) {
          positionHeardAt = Date.now();
        }
        state = next;
      });
    },

    leave() {
      socket?.disconnect();
      socket = undefined;
      standing = 'outside';
      admitted = false;
      streamTicket = null;
      state = emptyRoom();
    },

    /**
     * Where the Player's audio element pulls a Song's bytes from. Scoped to the
     * Track rather than the Song, so that the same Song queued twice in a row
     * still looks like a new source to the audio element and starts again.
     */
    streamSrc: (track: { id: string; song: { id: string } }) =>
      `${serverUrl()}/stream/${encodeURIComponent(track.song.id)}` +
      `?track=${encodeURIComponent(track.id)}` +
      `&ticket=${encodeURIComponent(streamTicket ?? '')}`,

    /** Only the Player may say these; it is the one thing that knows. */
    reportTrackEnded: (trackId: string) => socket?.emit('track/ended', trackId),
    reportPosition: (trackId: string, positionSeconds: number) =>
      socket?.emit('player/position', trackId, positionSeconds),

    pause: () => socket?.emit('transport/paused'),
    resume: () => socket?.emit('transport/resumed'),
    skip: (trackId: string) => socket?.emit('transport/skipped', trackId),
    previous: (trackId: string) => socket?.emit('transport/previous', trackId),

    /** Place a waiting Track after another; null puts it at the front. */
    moveTrack: (trackId: string, afterTrackId: string | null) =>
      socket?.emit('track/moved', trackId, afterTrackId),
    playNext: (trackId: string) => socket?.emit('track/play-next', trackId),
    removeTrack: (trackId: string) => socket?.emit('track/removed', trackId),
    setVolume: (volume: number) => socket?.emit('transport/volume', volume)

    ,

    addTrack: (url: string): Promise<AddResult> =>
      new Promise((resolve) => {
        if (!socket) return resolve({ ok: false, reason: 'Not connected yet.' });
        socket.emit('track/add', url, resolve);
      })
  };
}
