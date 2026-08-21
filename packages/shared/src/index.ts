/**
 * The Room's vocabulary, shared by the server that owns it and the Controllers
 * that display it. See CONTEXT.md for what each term means.
 */

export type SourceName = 'youtube';

/** A piece of audio at a Source, independent of anywhere it appears. */
export type Song = {
  id: string;
  source: SourceName;
  sourceId: string;
  title: string;
  author: string;
  durationSeconds: number;
  artworkUrl: string;
};

/** Where a Song appears in the Queue, and who put it there. */
export type Track = {
  id: string;
  song: Song;
  /** Fractional index, so a reorder rewrites one row and concurrent drags converge. */
  orderKey: string;
  addedByControllerId: string;
  addedByNickname: string;
  addedAt: number;
  /** Why this Track could not be played, when it could not be. */
  unplayableReason?: string;
};

export type Controller = {
  id: string;
  nickname: string;
  /**
   * Which live connection is speaking for this Controller. A reload opens a new
   * connection before the old one is reaped, and without this the old one's
   * departure erases the arrival that replaced it.
   */
  connectionId: string;
  connectedAt: number;
};

/**
 * What the Player is doing. The Player owns this and reports it; Controllers ask
 * for changes to it and display it.
 */
export type Transport = {
  isPlaying: boolean;
  /** The Player's own output level, between 0 and 1. Not the speaker's dial. */
  volume: number;
  /** How far into Now Playing the audio had reached when last reported. */
  positionSeconds: number;
  /** When that report was made, so a Controller can carry the clock forward itself. */
  positionReportedAt: number;
  /**
   * How many times the Song in Now Playing has failed to open. Reset whenever a
   * Track starts, so a Source having one bad moment costs a retry, not a Track.
   */
  failedAttempts: number;
  /**
   * When this playthrough of Now Playing began. Changes when a Track starts and
   * when one is restarted from the top, and is how the Player knows to seek —
   * restarting the Track it is already playing changes nothing else about it.
   */
  startedAt: number;
};

/** The last thing anyone did to the Transport, so the Room can see who did it. */
export type RoomAction = {
  nickname: string;
  at: number;
} & (
  | { did: 'paused' | 'resumed' | 'skipped' | 'previous' | 'restarted' | 'moved' | 'play-next' | 'removed' }
  /** Carried as the number it is; how to say it is the interface's business. */
  | { did: 'volume'; volume: number }
);

export type RoomState = {
  /** What has not played yet. Labelled "Up Next" in the interface. */
  queue: Track[];
  /** The Track currently sounding. Null means the Room is idle. */
  nowPlaying: Track | null;
  /** What has already played, most recent first. */
  history: Track[];
  transport: Transport;
  lastAction: RoomAction | null;
  controllers: Controller[];
  /**
   * Every connection currently attached to the speaker. Usually none or one, but
   * held as a list so that a second Player arriving and leaving again cannot
   * make the Room believe the first one went with it.
   */
  playerConnections: string[];
};

/** What came of trying to add a pasted link to the Queue. */
export type AddResult = { ok: true; song: Song } | { ok: false; reason: string };

/** A Room with nothing in it. The one place its shape is written down. */
export const emptyRoom = (): RoomState => ({
  queue: [],
  nowPlaying: null,
  history: [],
  transport: {
    isPlaying: false,
    volume: 1,
    positionSeconds: 0,
    positionReportedAt: 0,
    startedAt: 0,
    failedAttempts: 0
  },
  lastAction: null,
  controllers: [],
  playerConnections: []
});
