<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import { createRoom } from '$lib/room.svelte';
  import { createProgress } from '$lib/progress.svelte';
  import { asMinutesAndSeconds, describeAction } from '$lib/format';

  const room = createRoom();
  onMount(room.connect);
  onDestroy(room.disconnect);

  let url = $state('');
  let adding = $state(false);
  let problem = $state('');
  // The Room broadcasts a position report every second. Without this, a rebroadcast
  // mid-drag snaps the slider back under the finger holding it.
  let draggingVolume = $state(false);

  const progress = createProgress(() => ({
    positionSeconds: room.transport.positionSeconds,
    heardAt: room.positionHeardAt,
    isPlaying: room.transport.isPlaying,
    durationSeconds: room.nowPlaying?.song.durationSeconds ?? 0
  }));

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const pasted = url.trim();
    if (!pasted || adding) return;

    adding = true;
    problem = '';
    const result = await room.addTrack(pasted);
    adding = false;

    if (result.ok) url = '';
    else problem = result.reason;
  }
</script>

<main class="mx-auto min-h-dvh max-w-md bg-neutral-950 px-5 py-6 text-neutral-100">
  <header class="mb-6 flex items-baseline justify-between">
    <h1 class="text-xl font-semibold tracking-tight">Up Next</h1>
    <span class="text-xs text-neutral-500">
      {#if room.connected}{room.controllerCount} here{:else}connecting…{/if}
    </span>
  </header>

  {#if room.nowPlaying}
    {@const track = room.nowPlaying}
    <section class="mb-5 rounded-xl bg-neutral-900 p-3 ring-1 ring-neutral-800">
      <div class="flex items-center gap-3">
        <img src={track.song.artworkUrl} alt="" width="72" height="54" class="h-14 w-[4.5rem] shrink-0 rounded object-cover" />
        <div class="min-w-0 flex-1">
          <p class="text-[0.6875rem] uppercase tracking-wider text-neutral-500">Now playing</p>
          <p class="truncate text-sm font-medium">{track.song.title}</p>
          <p class="truncate text-xs text-neutral-500">
            {track.song.author} · added by {track.addedByNickname}
          </p>
        </div>
      </div>

      <div class="mt-3">
        <div class="h-1 overflow-hidden rounded-full bg-neutral-800">
          <div class="h-full bg-neutral-300" style="width: {progress.fraction * 100}%"></div>
        </div>
        <div class="mt-1 flex justify-between text-[0.6875rem] tabular-nums text-neutral-500">
          <span>{asMinutesAndSeconds(progress.seconds)}</span>
          <span>{asMinutesAndSeconds(track.song.durationSeconds)}</span>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2">
        <button
          onclick={() => (room.transport.isPlaying ? room.pause() : room.resume())}
          class="flex-1 rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-900"
        >
          {room.transport.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onclick={() => room.skip(track.id)}
          class="flex-1 rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-medium"
        >
          Skip
        </button>
      </div>

    </section>
  {/if}

  <label class="mb-4 block">
    <span class="text-[0.6875rem] text-neutral-500">
      App volume — the speaker's own dial is out of reach from here
    </span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={draggingVolume ? undefined : room.transport.volume}
      onpointerdown={() => (draggingVolume = true)}
      onpointerup={() => (draggingVolume = false)}
      onpointercancel={() => (draggingVolume = false)}
      oninput={(e) => room.setVolume(e.currentTarget.valueAsNumber)}
      class="mt-1 w-full accent-neutral-300"
    />
  </label>

  {#if room.lastAction}
    <p class="mb-4 text-center text-xs text-neutral-600">
      {room.lastAction.nickname}
      {describeAction(room.lastAction)}
    </p>
  {/if}

  <form onsubmit={add} class="mb-5 flex gap-2">
    <input
      bind:value={url}
      type="url"
      inputmode="url"
      placeholder="Paste a YouTube link"
      aria-label="YouTube link"
      class="min-w-0 flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-neutral-600"
    />
    <button
      type="submit"
      disabled={adding || !url.trim()}
      class="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
    >
      {adding ? 'Adding…' : 'Add'}
    </button>
  </form>

  {#if problem}
    <p role="alert" class="mb-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">{problem}</p>
  {/if}

  <h2 class="mb-2 text-xs uppercase tracking-wider text-neutral-500">Up next</h2>

  {#if room.queue.length === 0}
    <p class="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
      Nothing queued yet.
    </p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each room.queue as track (track.id)}
        <li class="flex items-center gap-3 rounded-lg bg-neutral-900 p-2">
          <img src={track.song.artworkUrl} alt="" width="56" height="42" class="h-11 w-14 shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{track.song.title}</p>
            <p class="truncate text-xs text-neutral-500">
              {track.song.author} · added by {track.addedByNickname}
            </p>
          </div>
          <span class="shrink-0 text-xs tabular-nums text-neutral-500">
            {asMinutesAndSeconds(track.song.durationSeconds)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</main>
