/**
 * Holds the screen on while the Room is playing.
 *
 * The speaker's screen is what the room looks at to see what is on, and a laptop
 * left alone dims and sleeps within minutes. The lock is dropped as soon as the
 * music stops, so an idle Room does not sit there burning a display all night.
 *
 * Needs a secure origin, which localhost is. Browsers also drop the lock whenever
 * the page is hidden, so it is taken again when the page comes back.
 */
export function keepAwakeWhile(playing: () => boolean) {
  let sentinel: WakeLockSentinel | null = null;
  /**
   * Which request is the current one. Taking a lock is asynchronous, so two can
   * be in flight at once — the effect re-running while the page becomes visible,
   * say. Without this the second overwrites the first and the first is held for
   * ever with nothing left holding a reference to release it.
   */
  let generation = 0;

  const wanted = () => playing() && document.visibilityState === 'visible';

  async function take() {
    if (sentinel || !('wakeLock' in navigator) || !wanted()) return;

    const mine = ++generation;
    try {
      const taken = await navigator.wakeLock.request('screen');

      // Something changed while we were asking. Give it straight back.
      if (mine !== generation || !wanted()) {
        void taken.release();
        return;
      }

      sentinel = taken;
      taken.addEventListener('release', () => {
        if (sentinel === taken) sentinel = null;
      });
    } catch (error) {
      // Refused — a laptop on low battery does this, and so does a window that
      // is not really on screen. The display sleeping is a smaller problem than
      // anything worth interrupting the room for, so it is said once and let go.
      console.warn('Could not keep the screen awake:', error);
    }
  }

  function release() {
    generation++;
    const held = sentinel;
    sentinel = null;
    void held?.release();
  }

  $effect(() => {
    if (playing()) void take();
    else release();
  });

  $effect(() => {
    const reconsider = () => (wanted() ? void take() : release());
    document.addEventListener('visibilitychange', reconsider);
    return () => {
      document.removeEventListener('visibilitychange', reconsider);
      release();
    };
  });
}
