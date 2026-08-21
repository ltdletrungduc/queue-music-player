import type { AddResult, Song, SourceName } from '@qmp/shared';

/** The audio of a Song, as bytes, with what it is encoded as. */
export type Stream = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

/** The verdict a Source gives on a pasted link. */
export type Validation = AddResult;

/**
 * Everything the Room needs to know about one Source. The only place that talks
 * to the outside world, so it is faked wherever behaviour is under test.
 */
export type SourceProvider = {
  /** Which Source this speaks for, so a Song can be sent back to the right one. */
  source: SourceName;
  /** Whether this provider is the one that should handle a pasted link. */
  matches(url: string): boolean;
  /** Confirms the link leads to something queueable, and describes the Song. */
  validate(url: string): Promise<Validation>;
  /** Opens the audio of a Song. Called only by the Player, and only when needed. */
  resolve(song: Song): Promise<Stream>;
};
