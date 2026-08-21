export const asMinutesAndSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Reads after a Nickname: "Duc skipped", "Mai set the volume to 40%". */
export function describeAction(action: { did: string; volume?: number }): string {
  switch (action.did) {
    case 'paused':
      return 'paused';
    case 'resumed':
      return 'started it again';
    case 'skipped':
      return 'skipped';
    case 'volume':
      return `set the volume to ${Math.round((action.volume ?? 0) * 100)}%`;
    default:
      return action.did;
  }
}
