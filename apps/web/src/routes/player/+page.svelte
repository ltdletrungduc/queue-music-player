<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import Artwork from '$lib/components/artwork.svelte';
  import JoinForm from '$lib/components/join-form.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import { Progress } from '$lib/components/ui/progress';
  import { Slider } from '$lib/components/ui/slider';
  import { createRoom } from '$lib/room.svelte';
  import { createProgress } from '$lib/progress.svelte';
  import { keepAwakeWhile } from '$lib/keep-awake.svelte';
  import { publishToMediaSession } from '$lib/media-session.svelte';
  import { asMinutesAndSeconds } from '$lib/format';
  import type { Song } from '@qmp/shared';

  const room = createRoom();

  // The Player's password is never remembered: see room.svelte.ts. Someone is
  // standing at this machine when the night starts, so typing it once is cheap.
  onDestroy(room.leave);

  let audio = $state<HTMLAudioElement | null>(null);

  /**
   * The slider belongs to whoever is dragging it until they let go. Binding it
   * straight to the Room snaps the handle back when the next snapshot lands.
   */
  let volumeDraft = $state<number | null>(null);
  const volume = $derived(volumeDraft ?? room.transport.volume);

  function setVolume(next: number) {
    volumeDraft = next;
    room.setVolume(next);
  }

  const volumeIcon = $derived(
    volume === 0
      ? 'icon-[ic--round-volume-off]'
      : volume < 0.5
        ? 'icon-[ic--round-volume-down]'
        : 'icon-[ic--round-volume-up]'
  );

  let started = $state(false);
  let problem = $state('');

  // Desktop shows the track and the list side by side; a narrow screen has room
  // for one at a time and switches between them.
  let tab = $state<'now' | 'list'>('now');
  const tabs: { id: 'now' | 'list'; label: string }[] = [
    { id: 'now', label: 'Now playing' },
    { id: 'list', label: 'Playlist' }
  ];
  let volumeOpen = $state(false);

  const nowPlaying = $derived(room.nowPlaying);

  // The dial is drawn inside the now-playing panel, so a Track ending unmounts
  // it without closing it. Left alone it springs back open — backdrop and all,
  // swallowing the first tap — the moment the next Track starts.
  $effect(() => {
    if (!nowPlaying) volumeOpen = false;
  });

  const progress = createProgress(() => ({
    positionSeconds: room.transport.positionSeconds,
    heardAt: room.positionHeardAt,
    isPlaying: room.transport.isPlaying,
    durationSeconds: room.nowPlaying?.song.durationSeconds ?? 0
  }));

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
    try {
      if (room.transport.isPlaying) await audio.play();
      else audio.pause();
    } catch (error) {
      problem = error instanceof Error ? error.message : 'Playback was refused.';
    }
  }

  /**
   * A playthrough is one attempt at one Track. The Room starts a new one when a
   * Track begins, when someone rewinds, and when a Track failed and deserves
   * another go — all of which show up as `startedAt` moving.
   *
   * Every new playthrough is loaded from scratch. That is what makes the retry
   * real: after a failure the element is stuck in an error state and will not
   * fetch anything again until it is told to.
   */
  let playthrough = -1;
  $effect(() => {
    const startedAt = room.transport.startedAt;
    const track = nowPlaying;
    const element = audio;
    if (!started || !element || !track || startedAt === playthrough) return;
    playthrough = startedAt;

    untrack(() => {
      // A fresh attempt: whatever went wrong last time is no longer the news.
      problem = '';
      element.load();
      if (room.transport.positionSeconds > 0) element.currentTime = room.transport.positionSeconds;
      void obeyTransport();
    });
  });

  /**
   * Coming back from a dropped connection changes nothing about the Room — same
   * Track, still wanted — so nothing above would fire, and the Player would sit
   * holding a stream that died. Forgetting the playthrough makes it start over.
   */
  $effect(() => {
    if (!room.connected) playthrough = -1;
  });

  // Pausing and resuming do not restart anything.
  $effect(() => {
    void room.transport.isPlaying;
    void obeyTransport();
  });

  $effect(() => {
    if (audio) audio.volume = room.transport.volume;
  });

  // The room looks at this screen to see what is on; a laptop left alone dims
  // within minutes.
  keepAwakeWhile(() => started && room.transport.isPlaying);

  // The same things the on-screen buttons do, on the machine's own media keys
  // and lock screen.
  publishToMediaSession({
    nowPlaying: () => (started ? room.nowPlaying : null),
    isPlaying: () => room.transport.isPlaying,
    onPause: room.pause,
    onResume: room.resume,
    onNext: () => room.nowPlaying && room.skip(room.nowPlaying.id),
    onPrevious: () => room.nowPlaying && room.previous(room.nowPlaying.id)
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

<!-- Escape puts the volume dial away, the same as tapping outside it. On the
     window because the toggle keeps focus when the dial opens. -->
<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') volumeOpen = false;
  }}
/>

{#if !room.admitted}
  <JoinForm
    title="The speaker"
    description="This device is the one that makes the sound. It has its own password."
    secretLabel="Player password"
    secretPlaceholder="Not the join code"
    secret=""
    knocking={room.standing === 'knocking'}
    refusal={room.refusal}
    onenter={({ secret }) => room.enter({ role: 'player', playerPassword: secret })}
  />
{:else if !started}
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
    <Button size="lg" class="h-14 rounded-full px-10 text-lg" onclick={start}>
      <span data-icon="inline-start" class="icon-[ic--round-play-arrow] size-6"></span>
      Start the speaker
    </Button>
    <p class="text-sm text-muted-foreground">Sound comes out of this device only.</p>
  </main>
{:else}
  {#snippet trackRow(song: Song, opts: { active?: boolean; dim?: boolean; struck?: boolean })}
    <li
      class={[
        'flex items-center gap-3 rounded-xl p-2 transition-colors',
        opts.active ? 'bg-accent' : 'hover:bg-muted',
        opts.dim && 'opacity-50'
      ]}
    >
      <Artwork src={song.artworkUrl} class="size-12 shrink-0 rounded-lg" />
      <div class="min-w-0 flex-1">
        <p class={['truncate font-medium', opts.struck && 'line-through']}>
          {song.title}
        </p>
        <p class="truncate text-sm text-muted-foreground">{song.author}</p>
      </div>
      {#if opts.active}
        <span
          class="icon-[ic--round-graphic-eq] size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        ></span>
      {/if}
    </li>
  {/snippet}

  <main class="relative min-h-dvh">
    <!-- One screen at a time on a phone; the segmented control switches between them. -->
    <div class="flex justify-center p-4 lg:hidden">
      <div class="inline-flex rounded-full bg-muted p-1">
        {#each tabs as { id, label } (id)}
          <button
            type="button"
            class={[
              'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
              tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
            ]}
            onclick={() => (tab = id)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <div
      class="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 pb-10 lg:grid-cols-[3fr_2fr] lg:gap-12 lg:px-12 lg:py-12"
    >
      <!-- Now playing: artwork first, read from across a room, then the controls. -->
      <section
        class={[
          'min-w-0 flex-col items-center justify-center gap-8',
          tab === 'now' ? 'flex' : 'hidden',
          'lg:flex'
        ]}
      >
        {#if nowPlaying}
          <div class="w-full max-w-[18rem] lg:max-w-sm">
            <Artwork
              src={nowPlaying.song.artworkUrl}
              class={[
                'aspect-square w-full rounded-full shadow-xl ring-1 ring-border transition-opacity',
                !room.transport.isPlaying && 'opacity-40'
              ]}
            />
          </div>

          <div class="flex min-w-0 max-w-md flex-col items-center gap-1 text-center">
            <h1 class="max-w-full truncate text-3xl font-semibold tracking-tight lg:text-4xl">
              {nowPlaying.song.title}
            </h1>
            <p class="max-w-full truncate text-lg text-muted-foreground">{nowPlaying.song.author}</p>
            <p class="max-w-full truncate text-sm text-muted-foreground">
              {#if room.transport.isPlaying}
                added by {nowPlaying.addedByNickname}
              {:else}
                Paused · added by {nowPlaying.addedByNickname}
              {/if}
            </p>
          </div>

          <div class="flex w-full max-w-md flex-col gap-2">
            <Progress value={progress.fraction * 100} max={100} class="h-1.5" />
            <div class="flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{asMinutesAndSeconds(progress.seconds)}</span>
              <span>{asMinutesAndSeconds(nowPlaying.song.durationSeconds)}</span>
            </div>
          </div>

          <div class="relative flex w-full max-w-md items-center justify-center gap-8">
            <button
              type="button"
              class="grid size-12 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => room.previous(nowPlaying.id)}
              aria-label="Previous"
            >
              <span class="icon-[ic--round-skip-previous] size-9"></span>
            </button>
            <button
              type="button"
              class="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              onclick={() => (room.transport.isPlaying ? room.pause() : room.resume())}
              aria-label={room.transport.isPlaying ? 'Pause' : 'Play'}
            >
              <span
                class="size-9 {room.transport.isPlaying
                  ? 'icon-[ic--round-pause]'
                  : 'icon-[ic--round-play-arrow]'}"
              ></span>
            </button>
            <button
              type="button"
              class="grid size-12 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => room.skip(nowPlaying.id)}
              aria-label="Next"
            >
              <span class="icon-[ic--round-skip-next] size-9"></span>
            </button>

            <!-- Volume opens a vertical dial, off to the side of the transport. -->
            <div class="absolute right-0">
              <button
                type="button"
                class="grid size-12 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                onclick={() => (volumeOpen = !volumeOpen)}
                aria-label="Volume"
                aria-expanded={volumeOpen}
              >
                <span class="{volumeIcon} size-7"></span>
              </button>
              {#if volumeOpen}
                <!-- A tap anywhere else puts the dial away. -->
                <button
                  type="button"
                  class="fixed inset-0 z-20 cursor-default"
                  tabindex="-1"
                  aria-hidden="true"
                  onclick={() => (volumeOpen = false)}
                ></button>
                <div
                  class="absolute bottom-full left-1/2 z-30 mb-3 flex -translate-x-1/2 flex-col items-center gap-3 rounded-2xl border bg-popover p-4 shadow-xl"
                >
                  <span class="w-12 text-center text-sm tabular-nums text-muted-foreground"
                    >{Math.round(volume * 100)}%</span
                  >
                  <Slider
                    type="single"
                    orientation="vertical"
                    value={volume}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={setVolume}
                    onValueCommit={() => (volumeDraft = null)}
                    aria-label="Volume"
                    class="h-40"
                  />
                  <span class="icon-[ic--round-volume-mute] size-5 text-muted-foreground"></span>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <Empty.Root>
            <Empty.Header>
              <Empty.Media variant="icon">
                <span class="icon-[ic--round-queue-music]"></span>
              </Empty.Media>
              <Empty.Title>Queue's empty</Empty.Title>
              <Empty.Description>Add something from your phone.</Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {/if}

        {#if problem}
          <Alert.Root variant="destructive" class="w-full max-w-md">
            <span class="icon-[ic--round-error-outline]"></span>
            <Alert.Description>{problem}</Alert.Description>
          </Alert.Root>
        {/if}
      </section>

      <!-- The list, beside the track on a wide screen or under its own tab on a phone. -->
      <aside
        class={[
          'min-w-0 flex-col gap-8',
          tab === 'list' ? 'flex' : 'hidden',
          'lg:flex'
        ]}
      >
        <section class="flex min-w-0 flex-col gap-3">
          <h2 class="text-sm uppercase tracking-widest text-muted-foreground">Playlist</h2>
          <ul class="flex flex-col gap-1">
            {#if nowPlaying}
              {@render trackRow(nowPlaying.song, { active: true })}
            {/if}
            {#each room.queue.slice(0, 6) as track (track.id)}
              {@render trackRow(track.song, {})}
            {/each}
          </ul>
          {#if room.queue.length > 6}
            <p class="text-sm text-muted-foreground">and {room.queue.length - 6} more</p>
          {:else if !nowPlaying && room.queue.length === 0}
            <p class="text-muted-foreground">Nothing waiting.</p>
          {/if}
        </section>

        {#if room.history.length > 0}
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-sm uppercase tracking-widest text-muted-foreground">Just played</h2>
            <ul class="flex flex-col gap-1">
              {#each room.history.slice(0, 3) as track (track.id)}
                {@render trackRow(track.song, { dim: true, struck: !!track.unplayableReason })}
              {/each}
            </ul>
          </section>
        {/if}
      </aside>
    </div>
  </main>
{/if}

{#if room.admitted && started}
  <!-- Kept outside the layout branches so a dropped connection cannot unmount it
       mid-Track, but never mounted before the speaker is armed: an element with a
       source will happily open the relay for a Track nobody has started. -->
  <audio
    bind:this={audio}
    src={nowPlaying ? room.streamSrc(nowPlaying) : undefined}
    onended={() => nowPlaying && room.reportTrackEnded(nowPlaying.id)}
    onerror={() => {
      problem = 'That Song would not play.';
      // The Room decides what to do about it: one more go, then give up on it.
      if (nowPlaying) room.reportTrackFailed(nowPlaying.id, problem);
    }}
  ></audio>
{/if}
