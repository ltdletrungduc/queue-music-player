export const asMinutesAndSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Reads after a Nickname: "Duc skipped", "Mai set the volume to 40%". */
export function describeAction(action: {
  did: string;
  volume?: number;
  playlistName?: string;
  added?: number;
  alreadyQueued?: number;
}): string {
  switch (action.did) {
    case 'paused':
      return 'paused';
    case 'resumed':
      return 'started it again';
    case 'skipped':
      return 'skipped';
    case 'previous':
      return 'went back';
    case 'moved':
      return 'moved a track';
    case 'play-next':
      return 'played a track next';
    case 'removed':
      return 'removed a track';
    case 'saved-to-playlist':
      return 'saved a track';
    case 'renamed-playlist':
      return 'renamed a playlist';
    case 'loaded-playlist': {
      const count = action.added ?? 0;
      const repeated = action.alreadyQueued ?? 0;
      const from = `added ${count} ${count === 1 ? 'track' : 'tracks'} from ${action.playlistName ?? 'a playlist'}`;
      // Flagged rather than quietly dropped: a repeat may well be deliberate.
      return repeated > 0 ? `${from} (${repeated} already queued)` : from;
    }
    case 'restarted':
      return 'started it over';
    case 'volume':
      return `set the volume to ${Math.round((action.volume ?? 0) * 100)}%`;
    default:
      return action.did;
  }
}
