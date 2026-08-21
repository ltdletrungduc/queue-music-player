<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import Icon from '@iconify/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
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

  // Restarting a Track changes nothing an audio element would notice on its own
  // — same Track, same source — so the Room says when a playthrough began and the
  // Player moves the needle to where the Room says it should be.
  //
  // Only the beginning of a *new* playthrough may move it. Every snapshot
  // replaces the Room wholesale, so this runs once a second whether or not
  // anything changed; seeking each time would drag the audio backwards to the
  // Player's own last report, for ever.
  let seekedTo = -1;
  $effect(() => {
    const startedAt = room.transport.startedAt;
    // Recording the seek before doing it would lose it entirely on the run where
    // the element is not mounted yet, and nothing would try again.
    if (!audio || startedAt === seekedTo) return;
    seekedTo = startedAt;
    untrack(() => {
      if (audio) audio.currentTime = room.transport.positionSeconds;
    });
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

<main class="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
  {#if !started}
    <Button size="lg" class="h-14 rounded-full px-10 text-lg" onclick={start}>
      <Icon icon="ic:round-play-arrow" data-icon="inline-start" />
      Start the speaker
    </Button>
    <p class="text-sm text-muted-foreground">Sound comes out of this device only.</p>
  {:else if nowPlaying}
    <img
      src={nowPlaying.song.artworkUrl}
      alt=""
      class="aspect-video w-full max-w-2xl rounded-xl object-cover shadow-2xl"
      class:opacity-40={!room.transport.isPlaying}
    />
    <div class="flex flex-col items-center gap-1 text-center">
      <h1 class="text-2xl font-semibold tracking-tight">{nowPlaying.song.title}</h1>
      <p class="text-muted-foreground">{nowPlaying.song.author}</p>
      <p class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {#if room.transport.isPlaying}
          added by {nowPlaying.addedByNickname}
        {:else}
          <Icon icon="ic:round-pause" />
          Paused
        {/if}
      </p>
    </div>
  {:else}
    <Empty.Root>
      <Empty.Header>
        <Empty.Media variant="icon">
          <Icon icon="ic:round-queue-music" />
        </Empty.Media>
        <Empty.Title>Queue's empty</Empty.Title>
        <Empty.Description>Add something from your phone.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}

  {#if problem}
    <Alert.Root variant="destructive" class="max-w-md">
      <Icon icon="ic:round-error-outline" />
      <Alert.Description>{problem}</Alert.Description>
    </Alert.Root>
  {/if}

  <audio
    bind:this={audio}
    src={nowPlaying ? room.streamSrc(nowPlaying) : undefined}
    onended={() => nowPlaying && room.reportTrackEnded(nowPlaying.id)}
    onerror={() => (problem = 'That Song would not play.')}
  ></audio>
</main>
