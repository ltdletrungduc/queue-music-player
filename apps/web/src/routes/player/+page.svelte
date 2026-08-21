<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import '../../app.css';
  import { createRoom } from '$lib/room.svelte';

  const room = createRoom();
  onMount(room.connect);
  onDestroy(room.disconnect);

  let audio = $state<HTMLAudioElement | null>(null);
  let started = $state(false);
  let problem = $state('');

  const nowPlaying = $derived(room.nowPlaying);

  // Browsers refuse to play sound until someone has asked for it, so the Player
  // is armed once and then left alone for the rest of the night.
  async function start() {
    started = true;
    await play();
  }

  async function play() {
    if (!audio || !nowPlaying) return;
    problem = '';
    try {
      await audio.play();
    } catch (error) {
      problem = error instanceof Error ? error.message : 'Playback was refused.';
    }
  }

  // A new Track in Now Playing means a new source; the element needs telling.
  $effect(() => {
    const trackId = nowPlaying?.id;
    if (!started || !audio || !trackId) return;
    void play();
  });
</script>

<main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-neutral-100">
  {#if !started}
    <button
      onclick={start}
      class="rounded-full bg-neutral-100 px-8 py-4 text-lg font-medium text-neutral-900"
    >
      Start the speaker
    </button>
    <p class="text-sm text-neutral-500">Sound comes out of this device only.</p>
  {:else if nowPlaying}
    <img
      src={nowPlaying.song.artworkUrl}
      alt=""
      class="aspect-video w-full max-w-2xl rounded-xl object-cover shadow-2xl"
    />
    <div class="text-center">
      <h1 class="text-2xl font-semibold tracking-tight">{nowPlaying.song.title}</h1>
      <p class="mt-1 text-neutral-400">{nowPlaying.song.author}</p>
      <p class="mt-3 text-xs text-neutral-600">added by {nowPlaying.addedByNickname}</p>
    </div>
  {:else}
    <p class="text-lg text-neutral-500">Queue's empty — add something from your phone.</p>
  {/if}

  {#if problem}
    <p role="alert" class="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">{problem}</p>
  {/if}

  <audio
    bind:this={audio}
    src={nowPlaying ? room.streamSrc(nowPlaying) : undefined}
    onended={() => nowPlaying && room.reportTrackEnded(nowPlaying.id)}
    onerror={() => (problem = 'That Song would not play.')}
  ></audio>
</main>
