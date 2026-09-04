import { randomBytes } from 'node:crypto';
import type { Server as SocketServer } from 'socket.io';
import { addTrackByUrl } from './room/add-track.js';
import type { RoomRuntime } from './room/room.js';
import type { Effect } from './room/types.js';
import type { SourceProvider } from './sources/types.js';
import { admits, type Access, type Role } from './access.js';
import { isFromThisMachine } from './local-only.js';
import type { AddResult, Song } from '@qmp/shared';

export type RealtimeDeps = {
  room: RoomRuntime;
  access: Access;
  /** The Source is reached for on first use, so it is asked for, not held. */
  sources: () => Promise<SourceProvider[]>;
  /** Drops the cached Source when it looks spent, so the next use rebuilds it. */
  forgetSources: () => void;
  /** Throwaway tickets for the audio endpoint, one per live Player connection. */
  streamTickets: Set<string>;
};

/**
 * Carries Commands in over the socket and snapshots back out. The logic here is
 * deliberately thin: every handler hands its Command to the reducer and every
 * effect back to the room — the room and the reducer are where behaviour lives.
 */
export function attachRealtime(io: SocketServer, deps: RealtimeDeps): void {
  const { room, access, sources, forgetSources, streamTickets } = deps;

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

    socket.on('transport/muted', () => {
      if (drivesTheTransport) apply(room.dispatch({ type: 'transport/muted', nickname }));
    });

    socket.on('transport/unmuted', () => {
      if (drivesTheTransport) apply(room.dispatch({ type: 'transport/unmuted', nickname }));
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
}
