/**
 * Where the audio is now, carried forward from the Player's last report.
 *
 * The Player says where it has reached once a second. Waiting for the next
 * report would make the bar jump; running a clock between reports makes it move
 * continuously, and each report pulls it straight again.
 *
 * Elapsed time is measured from when this device heard the report, never from a
 * timestamp made on another machine — phone clocks disagree by minutes, and a
 * progress bar built on that difference would be wrong by minutes.
 */
export function createProgress(source: () => {
  positionSeconds: number;
  heardAt: number;
  isPlaying: boolean;
  durationSeconds: number;
}) {
  let tick = $state(0);

  $effect(() => {
    const id = setInterval(() => (tick = tick + 1), 250);
    return () => clearInterval(id);
  });

  const seconds = $derived.by(() => {
    void tick;
    const { positionSeconds, heardAt, isPlaying, durationSeconds } = source();
    // A paused Room is exactly where it was left.
    const elapsed = isPlaying && heardAt > 0 ? (Date.now() - heardAt) / 1000 : 0;
    return Math.max(0, Math.min(durationSeconds, positionSeconds + elapsed));
  });

  const fraction = $derived.by(() => {
    const total = source().durationSeconds;
    return total > 0 ? seconds / total : 0;
  });

  return {
    get seconds() {
      return seconds;
    },
    get fraction() {
      return fraction;
    }
  };
}
