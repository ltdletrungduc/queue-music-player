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
    await obeyTransport();
  }

  /**
   * Pausing stops the audio element and nothing else: the relay is left open.
   *
   * The alternative is tearing the Stream down and re-resolving on resume, which
   * costs a fresh round trip to the Source and throws away everything already
   * buffered — a visible stall every time someone pauses to talk. Holding it open
   * costs one idle socket on a machine serving one Room, which is the cheaper of
   * the two by a wide margin.
   */
  async function obeyTransport() {
    if (!started || !audio || !nowPlaying) return;
    problem = '';
    try {
      if (room.transport.isPlaying) await audio.play();
      else audio.pause();
    } catch (error) {
      problem = error instanceof Error ? error.message : 'Playback was refused.';
    }
  }

  // The Room decides what the Player does; the Player only carries it out.
  $effect(() => {
    void nowPlaying?.id;
    void room.transport.isPlaying;
    void obeyTransport();
  });

  $effect(() => {
    if (audio) audio.volume = room.transport.volume;
  });

  // Nobody else can know where the audio has reached, so the Player says so
  // every second and the Controllers run their own clocks between reports.
  $effect(() => {
    const id = setInterval(() => {
      const track = nowPlaying;
      if (track && audio && !audio.paused) room.reportPosition(track.id, audio.currentTime);
    }, 1000);
    return () => clearInterval(id);
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
      class:opacity-40={!room.transport.isPlaying}
    />
    <div class="text-center">
      <h1 class="text-2xl font-semibold tracking-tight">{nowPlaying.song.title}</h1>
      <p class="mt-1 text-neutral-400">{nowPlaying.song.author}</p>
      <p class="mt-3 text-xs text-neutral-600">
        {#if room.transport.isPlaying}added by {nowPlaying.addedByNickname}{:else}Paused{/if}
      </p>
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
