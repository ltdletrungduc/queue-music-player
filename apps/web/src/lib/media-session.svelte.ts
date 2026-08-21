import type { Track } from '@qmp/shared';

type Controls = {
  nowPlaying: () => Track | null;
  isPlaying: () => boolean;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
};

/**
 * Puts what is playing on the machine's own media controls — the lock screen, the
 * keyboard's play key, the notification shade.
 *
 * The handlers ask the Room rather than touching the audio element, for the same
 * reason the on-screen buttons do: a play key that only this device knew about
 * would leave the Room and the speaker disagreeing.
 */
export function publishToMediaSession(controls: Controls) {
  const supported = 'mediaSession' in navigator;

  $effect(() => {
    if (!supported) return;

    const track = controls.nowPlaying();
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.song.title,
          artist: track.song.author,
          artwork: [{ src: track.song.artworkUrl }]
        })
      : null;

    // Leaving this page must not leave a Track sitting on the lock screen with
    // buttons that no longer do anything.
    return () => (navigator.mediaSession.metadata = null);
  });

  $effect(() => {
    if (!supported) return;
    navigator.mediaSession.playbackState = controls.isPlaying() ? 'playing' : 'paused';
    return () => (navigator.mediaSession.playbackState = 'none');
  });

  $effect(() => {
    if (!supported) return;

    navigator.mediaSession.setActionHandler('play', controls.onResume);
    navigator.mediaSession.setActionHandler('pause', controls.onPause);
    navigator.mediaSession.setActionHandler('nexttrack', controls.onNext);

    return () => {
      for (const action of ['play', 'pause', 'nexttrack'] as const) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    };
  });
}
