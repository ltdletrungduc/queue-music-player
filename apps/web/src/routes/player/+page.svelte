<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import JoinForm from '$lib/components/join-form.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import { Progress } from '$lib/components/ui/progress';
  import { createRoom } from '$lib/room.svelte';
  import { createProgress } from '$lib/progress.svelte';
  import { asMinutesAndSeconds } from '$lib/format';

  const room = createRoom();

  // The Player's password is never remembered: see room.svelte.ts. Someone is
  // standing at this machine when the night starts, so typing it once is cheap.
  onDestroy(room.leave);

  let audio = $state<HTMLAudioElement | null>(null);
  let started = $state(false);
  let problem = $state('');

  const nowPlaying = $derived(room.nowPlaying);

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
  <main class="grid min-h-dvh grid-cols-1 gap-8 p-8 lg:grid-cols-[3fr_2fr] lg:gap-12 lg:p-12">
    <!-- Read from across a room: artwork first, then the title, then everything else. -->
    <section class="flex min-w-0 flex-col justify-center gap-6">
      {#if nowPlaying}
        <img
          src={nowPlaying.song.artworkUrl}
          alt=""
          class="aspect-video w-full rounded-2xl object-cover shadow-2xl"
          class:opacity-40={!room.transport.isPlaying}
        />

        <div class="flex min-w-0 flex-col gap-2">
          <h1 class="truncate text-4xl font-semibold tracking-tight lg:text-5xl">
            {nowPlaying.song.title}
          </h1>
          <p class="truncate text-xl text-muted-foreground lg:text-2xl">{nowPlaying.song.author}</p>
          <p class="truncate text-base text-muted-foreground">
            {#if room.transport.isPlaying}
              added by {nowPlaying.addedByNickname}
            {:else}
              Paused · added by {nowPlaying.addedByNickname}
            {/if}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Progress value={progress.fraction * 100} max={100} />
          <div class="flex justify-between text-base tabular-nums text-muted-foreground">
            <span>{asMinutesAndSeconds(progress.seconds)}</span>
            <span>{asMinutesAndSeconds(nowPlaying.song.durationSeconds)}</span>
          </div>
        </div>

        <!-- Whoever's laptop this is, is standing next to it. The icons are sized
             past what the Button would choose, because this screen is meant to be
             read, and used, from the other side of a room. -->
        <div class="flex items-center gap-4">
          <Button
            size="icon-lg"
            class="size-20 rounded-full"
            onclick={() => (room.transport.isPlaying ? room.pause() : room.resume())}
            aria-label={room.transport.isPlaying ? 'Pause' : 'Play'}
          >
            <span
              class="size-10 {room.transport.isPlaying
                ? 'icon-[ic--round-pause]'
                : 'icon-[ic--round-play-arrow]'}"
            ></span>
          </Button>
          <Button
            variant="secondary"
            size="icon-lg"
            class="size-16 rounded-full"
            onclick={() => room.skip(nowPlaying.id)}
            aria-label="Next"
          >
            <span class="icon-[ic--round-skip-next] size-8"></span>
          </Button>
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
        <Alert.Root variant="destructive">
          <span class="icon-[ic--round-error-outline]"></span>
          <Alert.Description>{problem}</Alert.Description>
        </Alert.Root>
      {/if}
    </section>

    <aside class="flex min-w-0 flex-col gap-8 overflow-hidden">
      <section class="flex min-w-0 flex-col gap-3">
        <h2 class="text-base uppercase tracking-widest text-muted-foreground">Up next</h2>
        {#if room.queue.length === 0}
          <p class="text-lg text-muted-foreground">Nothing waiting.</p>
        {:else}
          <ul class="flex flex-col gap-3">
            {#each room.queue.slice(0, 5) as track (track.id)}
              <li class="flex min-w-0 items-center gap-4">
                <img
                  src={track.song.artworkUrl}
                  alt=""
                  class="h-14 w-[4.5rem] shrink-0 rounded-lg object-cover"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-lg font-medium">{track.song.title}</p>
                  <p class="truncate text-base text-muted-foreground">
                    {track.song.author} · {track.addedByNickname}
                  </p>
                </div>
              </li>
            {/each}
          </ul>
          {#if room.queue.length > 5}
            <p class="text-base text-muted-foreground">
              and {room.queue.length - 5} more
            </p>
          {/if}
        {/if}
      </section>

      {#if room.history.length > 0}
        <section class="flex min-w-0 flex-col gap-2">
          <h2 class="text-base uppercase tracking-widest text-muted-foreground">Just played</h2>
          <ul class="flex flex-col gap-1.5">
            {#each room.history.slice(0, 3) as track (track.id)}
              <li class="min-w-0 text-muted-foreground">
                <p class="truncate text-base" class:line-through={track.unplayableReason}>
                  {track.song.title}
                </p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </aside>
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
