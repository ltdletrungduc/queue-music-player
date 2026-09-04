import { generateKeyBetween } from 'fractional-indexing';
export { emptyRoom } from '@qmp/shared';
import type {
  Command,
  Ctx,
  Playlist,
  Reduced,
  RoomAction,
  RoomState,
  Song,
  Track,
  Transport
} from './types.js';

const unchanged = (state: RoomState): Reduced => ({ state, effects: [] });
const broadcast = (state: RoomState): Reduced => ({ state, effects: [{ type: 'broadcast-snapshot' }] });

/**
 * Nothing sounds while the Room is idle, so the moment a Track is waiting it is
 * pulled out of the Queue and into Now Playing. This is what makes adding to an
 * empty Queue start the music without anyone pressing anything.
 *
 * A Track arriving in Now Playing always plays: whatever the Room was doing
 * before, someone wanting this Track next is the more recent wish.
 */
/** A Track getting another go starts without the last attempt's verdict on it. */
const afresh = (track: Track): Track => {
  const { unplayableReason: _, ...rest } = track;
  return rest;
};

function startNextOrGoIdle(state: RoomState, now: number): RoomState {
  if (state.nowPlaying !== null) return state;
  const [head, ...rest] = state.queue;
  const next = head === undefined ? undefined : afresh(head);
  if (!next) {
    return state.transport.isPlaying || state.transport.failedAttempts > 0
      ? { ...state, transport: { ...state.transport, isPlaying: false, failedAttempts: 0 } }
      : state;
  }

  // A new Track starts owing nothing to the one before it, including whatever
  // trouble that one had opening.
  return {
    ...state,
    nowPlaying: next,
    queue: rest,
    transport: {
      ...state.transport,
      isPlaying: true,
      positionSeconds: 0,
      positionReportedAt: now,
      startedAt: now,
      failedAttempts: 0
    }
  };
}

/** Retires the Track that is sounding and brings the next one up. */
function retireNowPlaying(state: RoomState, now: number): RoomState {
  const finished = state.nowPlaying;
  if (!finished) return state;
  return startNextOrGoIdle({ ...state, nowPlaying: null, history: [finished, ...state.history] }, now);
}

const attributed = (state: RoomState, action: RoomAction): RoomState => ({ ...state, lastAction: action });

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Long enough that Previous takes you back to the last Track when you meant it,
 * short enough that it restarts the one playing once you have settled into it.
 * Every music player does this, and people expect it without knowing they do.
 */
const RESTART_THRESHOLD_SECONDS = 4;

/**
 * How far into Now Playing the audio actually is, as opposed to where it was
 * when the Player last said so. A paused Room has not moved since.
 */
function elapsedSeconds(transport: Transport, now: number): number {
  const { positionSeconds, positionReportedAt, isPlaying } = transport;
  if (!isPlaying || positionReportedAt === 0) return positionSeconds;
  return positionSeconds + (now - positionReportedAt) / 1000;
}

/**
 * Puts the audio back at the top of whatever is in Now Playing, and plays it.
 * Reaching for Previous is a request to hear something; a Room that stayed
 * silent after it would look broken.
 */
const fromTheTop = (state: RoomState, now: number): RoomState => ({
  ...state,
  transport: {
    ...state.transport,
    isPlaying: true,
    positionSeconds: 0,
    positionReportedAt: now,
    startedAt: now,
    failedAttempts: 0
  }
});

/**
 * Puts a waiting Track after another one, or at the front when nothing precedes
 * it. Only the moved Track's key changes, so two people dragging at once cannot
 * scramble the order between them.
 *
 * Returns null when the move cannot be made sense of: the Track is not waiting
 * (it may be Now Playing, which is not in the Queue at all), or whatever it was
 * to follow has since gone.
 */
function moved(queue: Track[], trackId: string, afterTrackId: string | null): Track[] | null {
  const moving = queue.find((t) => t.id === trackId);
  if (!moving) return null;

  const rest = queue.filter((t) => t.id !== trackId);
  const follows = rest.findIndex((t) => t.id === afterTrackId);
  if (afterTrackId !== null && follows === -1) return null;

  const landsAt = follows + 1;
  const before = rest[landsAt - 1]?.orderKey ?? null;
  const after = rest[landsAt]?.orderKey ?? null;

  return [
    ...rest.slice(0, landsAt),
    { ...moving, orderKey: generateKeyBetween(before, after) },
    ...rest.slice(landsAt)
  ];
}

/**
 * Steps back to the Track before this one, sending the Track being left to the
 * front of the Queue so it plays next rather than being lost.
 */
function goBack(state: RoomState, now: number): RoomState {
  const leaving = state.nowPlaying;
  const [wentBefore, ...older] = state.history;
  if (!leaving || !wentBefore) return fromTheTop(state, now);

  const firstWaiting = state.queue[0]?.orderKey ?? null;
  return fromTheTop(
    {
      ...state,
      nowPlaying: afresh(wentBefore),
      history: older,
      queue: [
        { ...afresh(leaving), orderKey: generateKeyBetween(null, firstWaiting) },
        ...state.queue
      ]
    },
    now
  );
}

/** A saved Track. It carries no place in the Queue, because it is not in one. */
function savedTrack(song: Song, after: Track | undefined, nickname: string, ctx: Ctx): Track {
  return {
    id: ctx.newId(),
    song,
    orderKey: generateKeyBetween(after?.orderKey ?? null, null),
    addedByNickname: nickname,
    addedAt: ctx.now
  };
}

export function reduce(state: RoomState, command: Command, ctx: Ctx): Reduced {
  switch (command.type) {
    case 'controller/connected': {
      const others = state.controllers.filter((c) => c.id !== command.controllerId);
      return broadcast({
        ...state,
        controllers: [
          ...others,
          {
            id: command.controllerId,
            nickname: command.nickname,
            connectionId: command.connectionId,
            connectedAt: ctx.now
          }
        ]
      });
    }

    case 'controller/disconnected': {
      // A reload opens the new connection before the old one is reaped, so a
      // departure only counts if it comes from the connection currently
      // speaking for this Controller. Otherwise the old one erases its own
      // replacement and the phone vanishes from a Room it is sitting in.
      const present = state.controllers.find((c) => c.id === command.controllerId);
      if (present?.connectionId !== command.connectionId) return unchanged(state);
      return broadcast({
        ...state,
        controllers: state.controllers.filter((c) => c.id !== command.controllerId)
      });
    }

    case 'player/connected': {
      if (state.playerConnections.includes(command.connectionId)) return unchanged(state);
      return broadcast({
        ...state,
        playerConnections: [...state.playerConnections, command.connectionId]
      });
    }

    case 'player/disconnected': {
      if (!state.playerConnections.includes(command.connectionId)) return unchanged(state);
      // The Transport is what the Room wants, not what is currently audible.
      // Leaving it alone is what lets a Player that drops and comes back pick
      // the Track up rather than finding the Room paused behind it.
      return broadcast({
        ...state,
        playerConnections: state.playerConnections.filter((id) => id !== command.connectionId)
      });
    }

    case 'track/failed': {
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);

      // A Source has bad moments. One retry costs a second; giving up at once
      // costs someone their Track.
      if (state.transport.failedAttempts === 0) {
        return broadcast({
          ...state,
          transport: {
            ...state.transport,
            failedAttempts: 1,
            positionSeconds: 0,
            positionReportedAt: ctx.now,
            startedAt: ctx.now
          }
        });
      }

      const abandoned = { ...state.nowPlaying, unplayableReason: command.reason };
      return broadcast(
        startNextOrGoIdle(
          { ...state, nowPlaying: null, history: [abandoned, ...state.history] },
          ctx.now
        )
      );
    }

    case 'track/added': {
      // Ordering spans the Queue only; Now Playing has left it.
      const last = state.queue.at(-1)?.orderKey ?? null;
      const track: Track = {
        id: ctx.newId(),
        song: command.song,
        orderKey: generateKeyBetween(last, null),
        addedByNickname: command.nickname,
        addedAt: ctx.now
      };
      return broadcast(startNextOrGoIdle({ ...state, queue: [...state.queue, track] }, ctx.now));
    }

    case 'track/ended': {
      // A Player that reconnects, or a second one, can report a Track that has
      // already been dealt with. Only the Track actually sounding may end.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return broadcast(retireNowPlaying(state, ctx.now));
    }

    case 'track/moved': {
      const reordered = moved(state.queue, command.trackId, command.afterTrackId);
      if (!reordered) return unchanged(state);
      return broadcast(
        attributed(
          { ...state, queue: reordered },
          { nickname: command.nickname, did: 'moved', at: ctx.now }
        )
      );
    }

    case 'track/play-next': {
      const reordered = moved(state.queue, command.trackId, null);
      if (!reordered) return unchanged(state);
      return broadcast(
        attributed(
          { ...state, queue: reordered },
          { nickname: command.nickname, did: 'play-next', at: ctx.now }
        )
      );
    }

    case 'track/removed': {
      if (!state.queue.some((t) => t.id === command.trackId)) return unchanged(state);
      return broadcast(
        attributed(
          { ...state, queue: state.queue.filter((t) => t.id !== command.trackId) },
          { nickname: command.nickname, did: 'removed', at: ctx.now }
        )
      );
    }

    case 'playlist/track-saved': {
      const existing = state.playlists.find((p) => p.id === command.playlistId);
      if (command.playlistId !== null && !existing) return unchanged(state);

      // A Song appears in a Playlist at most once. Saying so and changing
      // nothing beats quietly growing a list of the same Song.
      if (existing?.tracks.some((t) => t.song.id === command.song.id)) return unchanged(state);

      const saved = savedTrack(command.song, existing?.tracks.at(-1), command.nickname, ctx);
      const playlists = existing
        ? state.playlists.map((p) =>
            p.id === existing.id ? { ...p, tracks: [...p.tracks, saved] } : p
          )
        : [
            ...state.playlists,
            {
              id: ctx.newId(),
              name: command.newPlaylistName?.trim() || 'Saved',
              createdByNickname: command.nickname,
              createdAt: ctx.now,
              tracks: [saved]
            } satisfies Playlist
          ];

      return broadcast(
        attributed({ ...state, playlists }, {
          nickname: command.nickname,
          did: 'saved-to-playlist',
          at: ctx.now
        })
      );
    }

    case 'playlist/renamed': {
      const name = command.name.trim();
      if (!name || !state.playlists.some((p) => p.id === command.playlistId)) {
        return unchanged(state);
      }
      return broadcast(
        attributed(
          {
            ...state,
            playlists: state.playlists.map((p) =>
              p.id === command.playlistId ? { ...p, name } : p
            )
          },
          { nickname: command.nickname, did: 'renamed-playlist', at: ctx.now }
        )
      );
    }

    case 'playlist/loaded': {
      const playlist = state.playlists.find((p) => p.id === command.playlistId);
      if (!playlist || playlist.tracks.length === 0) return unchanged(state);

      // Copies, so that whatever happens to the Queue tonight leaves the saved
      // Playlist as it was.
      // Being already in the Queue is worth saying, never worth acting on: a
      // Song someone deliberately queued twice is theirs to queue twice.
      const alreadyWaiting = new Set(state.queue.map((t) => t.song.id));
      const alreadyQueued = playlist.tracks.filter((t) => alreadyWaiting.has(t.song.id)).length;

      let last = state.queue.at(-1);
      const copies = playlist.tracks.map((saved) => {
        const copy: Track = {
          id: ctx.newId(),
          song: saved.song,
          orderKey: generateKeyBetween(last?.orderKey ?? null, null),
                addedByNickname: command.nickname,
          addedAt: ctx.now
        };
        last = copy;
        return copy;
      });

      return broadcast(
        attributed(
          startNextOrGoIdle({ ...state, queue: [...state.queue, ...copies] }, ctx.now),
          {
            nickname: command.nickname,
            did: 'loaded-playlist',
            playlistName: playlist.name,
            added: copies.length,
            alreadyQueued,
            at: ctx.now
          }
        )
      );
    }

    case 'transport/paused': {
      if (!state.transport.isPlaying) return unchanged(state);
      return broadcast(
        attributed({ ...state, transport: { ...state.transport, isPlaying: false } }, {
          nickname: command.nickname,
          did: 'paused',
          at: ctx.now
        })
      );
    }

    case 'transport/resumed': {
      if (state.transport.isPlaying || !state.nowPlaying) return unchanged(state);
      return broadcast(
        attributed(
          {
            ...state,
            // The clock starts again from here. Without this, everyone's progress
            // bar counts the whole pause as time played and leaps to the end.
            transport: { ...state.transport, isPlaying: true, positionReportedAt: ctx.now }
          },
          { nickname: command.nickname, did: 'resumed', at: ctx.now }
        )
      );
    }

    case 'transport/skipped': {
      // Same rule as ending: only the Track actually sounding may be skipped.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return broadcast(
        attributed(retireNowPlaying(state, ctx.now), {
          nickname: command.nickname,
          did: 'skipped',
          at: ctx.now
        })
      );
    }

    case 'transport/previous': {
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);

      // Well into a Track, or with nothing behind it, Previous means "again".
      const settledIn = elapsedSeconds(state.transport, ctx.now) > RESTART_THRESHOLD_SECONDS;
      const goingBack = !settledIn && state.history.length > 0;

      return broadcast(
        attributed(goingBack ? goBack(state, ctx.now) : fromTheTop(state, ctx.now), {
          nickname: command.nickname,
          did: goingBack ? 'previous' : 'restarted',
          at: ctx.now
        })
      );
    }

    case 'transport/volume': {
      const volume = clamp(command.volume);
      // Setting the level by hand is the plainest way of saying how loud the
      // Room should be, so it ends any mute — including a move to zero, which
      // changes no level but does change what unmuting would do.
      const wasMuted = typeof state.transport.volumeBeforeMute === 'number';
      if (volume === state.transport.volume && !wasMuted) return unchanged(state);
      return broadcast(
        attributed({ ...state, transport: { ...state.transport, volume, volumeBeforeMute: null } }, {
          nickname: command.nickname,
          did: 'volume',
          volume,
          at: ctx.now
        })
      );
    }

    case 'transport/muted': {
      // Muting a Room that is already hushed would overwrite the level it was
      // hushed from with zero, and there would be nothing to come back to.
      if (typeof state.transport.volumeBeforeMute === 'number') return unchanged(state);
      return broadcast(
        attributed(
          {
            ...state,
            transport: {
              ...state.transport,
              volume: 0,
              volumeBeforeMute: state.transport.volume
            }
          },
          { nickname: command.nickname, did: 'muted', at: ctx.now }
        )
      );
    }

    case 'transport/unmuted': {
      const before = state.transport.volumeBeforeMute;
      if (typeof before !== 'number') return unchanged(state);
      return broadcast(
        attributed(
          { ...state, transport: { ...state.transport, volume: before, volumeBeforeMute: null } },
          { nickname: command.nickname, did: 'unmuted', at: ctx.now }
        )
      );
    }

    case 'player/position': {
      // A report about a Track that has already moved on would drag the progress
      // bar backwards into a Track nobody is hearing.
      if (state.nowPlaying?.id !== command.trackId) return unchanged(state);
      return {
        state: {
          ...state,
          transport: {
            ...state.transport,
            positionSeconds: command.positionSeconds,
            positionReportedAt: ctx.now
          }
        },
        effects: [
          {
            type: 'broadcast-position',
            trackId: command.trackId,
            positionSeconds: command.positionSeconds,
            reportedAt: ctx.now
          }
        ]
      };
    }
  }
}
