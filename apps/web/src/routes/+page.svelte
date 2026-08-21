<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import { createRoom } from '$lib/room.svelte';

  const room = createRoom();
  onMount(room.connect);
  onDestroy(room.disconnect);
</script>

<main class="mx-auto min-h-dvh max-w-md bg-neutral-950 px-5 py-6 text-neutral-100">
  <header class="mb-6 flex items-baseline justify-between">
    <h1 class="text-xl font-semibold tracking-tight">Up Next</h1>
    <span class="text-xs text-neutral-500">
      {#if room.connected}
        {room.controllerCount} here
      {:else}
        connecting…
      {/if}
    </span>
  </header>

  <p class="rounded-lg border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
    Nothing queued yet.
  </p>
</main>
