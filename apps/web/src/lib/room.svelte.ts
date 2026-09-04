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

/**
 * A v4 UUID, without needing a secure context.
 *
 * crypto.randomUUID is only defined on HTTPS and on localhost. The Room is
 * reached over plain http at a LAN address all the time — a phone opening
 * http://192.168.x.x is precisely the device this identity exists for, and
 * precisely where randomUUID is missing. getRandomValues carries no such
 * restriction, so the randomness behind the fallback is the same.
 */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

/** Stable per-device identity, so a reload is the same Controller reconnecting. */
function controllerId(): string {
  const existing = localStorage.getItem(CONTROLLER_ID_KEY);
  if (existing) return existing;
  const fresh = uuid();
  localStorage.setItem(CONTROLLER_ID_KEY, fresh);
  return fresh;
}

/** Matches PORT in the server. Only needed while Vite serves this page itself. */
const DEV_SERVER_PORT = 5858;

/**
 * Where the Room is.
 *
 * In production the server serves this page too, so it is wherever the page came
 * from — which is what makes a tunnel work: it terminates TLS on one origin and
 * knows nothing about a second port. In development Vite serves the page on its
 * own port and the server is next door.
 */
const serverUrl = () =>
  import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${DEV_SERVER_PORT}` : location.origin;

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
    /** Whether anything is attached to the speaker at all. */
    get playlists() {
      return state.playlists;
    },
    get playerConnected() {
      return state.playerConnections.length > 0;
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

      // The Room can let a connection go deliberately — a second Player taking
      // the speaker is the only thing that does it. Socket.IO does not retry
      // after a server-side disconnect, so the reason is kept and shown rather
      // than leaving the page knocking at a door nobody is going to answer.
      let letGo: string | null = null;
      socket.on('let-go', (reason: string) => (letGo = reason));

      socket.on('disconnect', (reason: string) => {
        if (reason === 'io client disconnect') return;
        if (reason === 'io server disconnect') {
          standing = 'outside';
          admitted = false;
          refusal = letGo ?? 'The Room let this connection go.';
          return;
        }
        standing = 'knocking';
      });

      socket.on('room', (next: RoomState) => {
        if (next.transport.positionReportedAt !== state.transport.positionReportedAt) {
          positionHeardAt = Date.now();
        }
        state = next;
      });

      /**
       * The Player's position, on its own.
       *
       * Only the Transport is touched. Replacing the whole Room once a second —
       * which is what this used to be — handed every list a new array each time
       * and made the browser refetch artwork that had not changed.
       */
      socket.on('position', (trackId: string, positionSeconds: number, reportedAt: number) => {
        if (state.nowPlaying?.id !== trackId) return;
        state.transport = { ...state.transport, positionSeconds, positionReportedAt: reportedAt };
        positionHeardAt = Date.now();
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
    reportTrackFailed: (trackId: string, reason: string) =>
      socket?.emit('track/failed', trackId, reason),

    pause: () => socket?.emit('transport/paused'),
    resume: () => socket?.emit('transport/resumed'),
    skip: (trackId: string) => socket?.emit('transport/skipped', trackId),
    previous: (trackId: string) => socket?.emit('transport/previous', trackId),

    /** Place a waiting Track after another; null puts it at the front. */
    moveTrack: (trackId: string, afterTrackId: string | null) =>
      socket?.emit('track/moved', trackId, afterTrackId),
    playNext: (trackId: string) => socket?.emit('track/play-next', trackId),
    removeTrack: (trackId: string) => socket?.emit('track/removed', trackId),

    /** Save a Song into a Playlist; a null id starts a new one under `name`. */
    saveToPlaylist: (playlistId: string | null, name: string | null, songId: string) =>
      socket?.emit('playlist/track-saved', playlistId, name, songId),
    renamePlaylist: (playlistId: string, name: string) =>
      socket?.emit('playlist/renamed', playlistId, name),
    loadPlaylist: (playlistId: string) => socket?.emit('playlist/loaded', playlistId),
    setVolume: (volume: number) => socket?.emit('transport/volume', volume),
    mute: () => socket?.emit('transport/muted'),
    unmute: () => socket?.emit('transport/unmuted')

    ,

    addTrack: (url: string): Promise<AddResult> =>
      new Promise((resolve) => {
        if (!socket) return resolve({ ok: false, reason: 'Not connected yet.' });
        socket.emit('track/add', url, resolve);
      })
  };
}
