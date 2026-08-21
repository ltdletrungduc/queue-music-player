<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import { createRoom } from '$lib/room.svelte';

  const room = createRoom();
  onMount(room.connect);
  onDestroy(room.disconnect);

  let url = $state('');
  let adding = $state(false);
  let problem = $state('');

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

  const asMinutesAndSeconds = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
</script>

<main class="mx-auto min-h-dvh max-w-md bg-neutral-950 px-5 py-6 text-neutral-100">
  <header class="mb-6 flex items-baseline justify-between">
    <h1 class="text-xl font-semibold tracking-tight">Up Next</h1>
    <span class="text-xs text-neutral-500">
      {#if room.connected}{room.controllerCount} here{:else}connecting…{/if}
    </span>
  </header>

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
