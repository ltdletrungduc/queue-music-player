import type { AddResult } from '@qmp/shared';

/** The verdict a Source gives on a pasted link. */
export type Validation = AddResult;

/**
 * Everything the Room needs to know about one Source. The only place that talks
 * to the outside world, so it is faked wherever behaviour is under test.
 */
export type SourceProvider = {
  /** Whether this provider is the one that should handle a pasted link. */
  matches(url: string): boolean;
  /** Confirms the link leads to something queueable, and describes the Song. */
  validate(url: string): Promise<Validation>;
};
