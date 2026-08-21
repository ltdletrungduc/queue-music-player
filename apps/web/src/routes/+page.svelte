<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import { createRoom } from '$lib/room.svelte';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { createProgress } from '$lib/progress.svelte';
  import { asMinutesAndSeconds, describeAction } from '$lib/format';
  import type { Track } from '@qmp/shared';

  const room = createRoom();
  onMount(room.connect);
  onDestroy(room.disconnect);

  let url = $state('');
  let adding = $state(false);
  let problem = $state('');
  // The Room broadcasts a position report every second. Without this, a rebroadcast
  // mid-drag snaps the slider back under the finger holding it.
  let draggingVolume = $state(false);

  /**
   * While someone is dragging, and until the Room has caught up with where they
   * dropped it, the list on screen is theirs rather than the Room's. Snapshots
   * arrive every second and would otherwise yank the Track back out from under
   * the finger holding it.
   */
  let ownOrder = $state<Track[] | null>(null);
  let ownOrderTimer: ReturnType<typeof setTimeout> | undefined;
  const upNext = $derived(ownOrder ?? room.queue);

  const sameOrder = (a: Track[], b: Track[]) =>
    a.length === b.length && a.every((track, i) => track.id === b[i]?.id);

  $effect(() => {
    const queue = room.queue;
    if (ownOrder && sameOrder(ownOrder, queue)) ownOrder = null;
  });

  /**
   * Hand the list back even if the Room never agrees. A move the Room refuses —
   * dropped against a Track that has since played — changes nothing, so no
   * snapshot follows it, and waiting for one would leave this phone showing an
   * order that exists nowhere else for the rest of the night.
   */
  function releaseTheListShortly() {
    clearTimeout(ownOrderTimer);
    ownOrderTimer = setTimeout(() => (ownOrder = null), 3000);
  }

  /**
   * A finger has to rest on a Track before it starts dragging. Without the pause
   * a phone can never scroll past Up Next, because every row would grab the
   * first swipe that touched it. A mouse is unaffected.
   */
  const HOLD_TO_DRAG_MS = 200;

  function considering(event: CustomEvent<DndEvent<Track>>) {
    ownOrder = event.detail.items;
    clearTimeout(ownOrderTimer);
  }

  function dropped(event: CustomEvent<DndEvent<Track>>) {
    const dropOrder = event.detail.items;
    ownOrder = dropOrder;
    releaseTheListShortly();

    // Ask the drag which Track was carried. Guessing from what changed position
    // finds the Track that was pushed aside, not the one someone moved.
    const movedId = String(event.detail.info.id);
    const landed = dropOrder.findIndex((t) => t.id === movedId);
    if (landed === -1) return;

    // Say where it sits rather than renumbering: one Track's key changes, and two
    // people dragging at once cannot scramble the order between them.
    room.moveTrack(movedId, dropOrder[landed - 1]?.id ?? null);
  }

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
          onclick={() => room.previous(track.id)}
          class="flex-1 rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-medium"
        >
          Previous
        </button>
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

  {#if upNext.length === 0}
    <p class="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
      Nothing queued yet.
    </p>
  {:else}
    <ul
      class="flex flex-col gap-2"
      use:dndzone={{ items: upNext, flipDurationMs: 150, delayTouchStart: HOLD_TO_DRAG_MS, dropTargetStyle: {} }}
      onconsider={considering}
      onfinalize={dropped}
    >
      {#each upNext as track, index (track.id)}
        <li class="flex items-center gap-2 rounded-lg bg-neutral-900 p-2" animate:flip={{ duration: 150 }}>
          <span aria-hidden="true" class="shrink-0 cursor-grab px-1.5 py-3 text-neutral-600">⠿</span>
          <img src={track.song.artworkUrl} alt="" width="56" height="42" class="h-11 w-14 shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{track.song.title}</p>
            <p class="truncate text-xs text-neutral-500">
              {track.song.author} · {asMinutesAndSeconds(track.song.durationSeconds)} · added by {track.addedByNickname}
            </p>
          </div>
          {#if index > 0}
            <button
              onclick={() => room.playNext(track.id)}
              aria-label="Play {track.song.title} next"
              class="shrink-0 rounded-md bg-neutral-800 px-2 py-1.5 text-[0.6875rem] font-medium"
            >
              Play next
            </button>
          {/if}
          <button
            onclick={() => room.removeTrack(track.id)}
            aria-label="Remove {track.song.title}"
            class="shrink-0 rounded-md px-2 py-1.5 text-[0.6875rem] text-neutral-500"
          >
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if room.history.length > 0}
    <h2 class="mt-6 mb-2 text-xs uppercase tracking-wider text-neutral-500">Already played</h2>
    <ul class="flex flex-col gap-1">
      {#each room.history as track (track.id)}
        <li class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-neutral-500">
          <img src={track.song.artworkUrl} alt="" width="40" height="30" class="h-8 w-10 shrink-0 rounded object-cover opacity-50" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs">{track.song.title}</p>
            <p class="truncate text-[0.6875rem] text-neutral-600">added by {track.addedByNickname}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>
