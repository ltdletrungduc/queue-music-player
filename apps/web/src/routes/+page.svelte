<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import { Progress } from '$lib/components/ui/progress';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import JoinForm from '$lib/components/join-form.svelte';
  import SaveToPlaylist from '$lib/components/save-to-playlist.svelte';
  import { createRoom, remembered } from '$lib/room.svelte';
  import { createProgress } from '$lib/progress.svelte';
  import { asMinutesAndSeconds, describeAction } from '$lib/format';
  import type { Track } from '@qmp/shared';

  const room = createRoom();
  // Read before the first render, so the form opens already filled in rather
  // than filling itself in a moment later. Safe because this app never renders
  // on a server.
  const known = remembered();

  onMount(() => {
    // Nobody types the code twice: if this device has been in before, walk in.
    if (known.joinCode && known.nickname) {
      room.enter({ role: 'controller', joinCode: known.joinCode, nickname: known.nickname });
    }
  });
  onDestroy(room.leave);

  let url = $state('');
  let adding = $state(false);
  let problem = $state('');

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

  /**
   * The slider is this phone's until the finger lifts. The Room rebroadcasts
   * every second, and binding straight to it snaps the handle back mid-drag.
   */
  let volumeDraft = $state<number | null>(null);
  const volume = $derived(volumeDraft ?? room.transport.volume);

  function setVolume(next: number) {
    volumeDraft = next;
    room.setVolume(next);
  }

  const save = (songId: string) => (playlistId: string | null, newName: string | null) =>
    room.saveToPlaylist(playlistId, newName, songId);

  let renaming = $state<{ id: string; name: string } | null>(null);

  function commitRename(event: SubmitEvent) {
    event.preventDefault();
    const target = renaming;
    if (!target?.name.trim()) return;
    room.renamePlaylist(target.id, target.name.trim());
    renaming = null;
  }

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

{#if !room.admitted}
  <JoinForm
    title="Queue"
    description="The Room is only for people who were told the code."
    secretLabel="Join code"
    secretPlaceholder="The code you were given"
    secret={known.joinCode}
    nickname={known.nickname}
    knocking={room.standing === 'knocking'}
    refusal={room.refusal}
    onenter={({ secret, nickname }) =>
      room.enter({ role: 'controller', joinCode: secret, nickname })}
  />
{:else}
<main class="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-5">
  <header class="flex items-baseline justify-between">
    <h1 class="text-xl font-semibold tracking-tight">Queue</h1>
    {#if room.connected}
      <Badge variant="secondary">{room.controllerCount} here</Badge>
    {:else}
      <Badge variant="outline">reconnecting…</Badge>
    {/if}
  </header>

  {#if !room.playerConnected}
    <Alert.Root>
      <span class="icon-[ic--round-speaker] size-4"></span>
      <Alert.Title>Nobody's playing</Alert.Title>
      <Alert.Description>
        Ask whoever has the speaker. You can keep queuing in the meantime.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if room.nowPlaying}
    {@const track = room.nowPlaying}
    <Card.Root>
      <Card.Header class="min-w-0 gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <img
            src={track.song.artworkUrl}
            alt=""
            class="h-14 w-[4.5rem] shrink-0 rounded-md object-cover"
          />
          <div class="min-w-0 flex-1">
            <Badge variant="secondary">
              {room.transport.isPlaying ? 'Now playing' : 'Paused'}
            </Badge>
            <Card.Title class="truncate">{track.song.title}</Card.Title>
            <Card.Description class="truncate">
              {track.song.author} · added by {track.addedByNickname}
            </Card.Description>
          </div>
          <SaveToPlaylist
            songTitle={track.song.title}
            songId={track.song.id}
            playlists={room.playlists}
            onsave={save(track.song.id)}
          />
        </div>
      </Card.Header>

      <Card.Content class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <Progress value={progress.fraction * 100} max={100} />
          <div class="flex justify-between text-[0.6875rem] tabular-nums text-muted-foreground">
            <span>{asMinutesAndSeconds(progress.seconds)}</span>
            <span>{asMinutesAndSeconds(track.song.durationSeconds)}</span>
          </div>
        </div>

        <div class="flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon-lg" class="size-12" onclick={() => room.previous(track.id)} aria-label="Previous">
            <span class="icon-[ic--round-skip-previous] size-5"></span>
          </Button>
          <Button
            size="icon-lg"
            class="size-14 rounded-full"
            onclick={() => (room.transport.isPlaying ? room.pause() : room.resume())}
            aria-label={room.transport.isPlaying ? 'Pause' : 'Play'}
          >
            <span
              class="size-7 {room.transport.isPlaying
                ? 'icon-[ic--round-pause]'
                : 'icon-[ic--round-play-arrow]'}"
            ></span>
          </Button>
          <Button variant="ghost" size="icon-lg" class="size-12" onclick={() => room.skip(track.id)} aria-label="Skip">
            <span class="icon-[ic--round-skip-next] size-5"></span>
          </Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <div class="flex items-center gap-3">
    <span class="icon-[ic--round-volume-up] size-5 shrink-0 text-muted-foreground"></span>
    <Slider
      type="single"
      value={volume}
      min={0}
      max={1}
      step={0.05}
      onValueChange={setVolume}
      onValueCommit={() => (volumeDraft = null)}
      aria-label="App volume"
      class="flex-1"
    />
  </div>
  <p class="-mt-2 text-[0.6875rem] text-muted-foreground">
    App volume — the speaker's own dial is out of reach from here
  </p>

  {#if room.lastAction}
    <p class="text-center text-xs text-muted-foreground">
      {room.lastAction.nickname}
      {describeAction(room.lastAction)}
    </p>
  {/if}

  <form onsubmit={add}>
    <InputGroup.Root>
      <InputGroup.Input
        bind:value={url}
        type="url"
        inputmode="url"
        placeholder="Paste a YouTube link"
        aria-label="YouTube link"
        aria-invalid={problem ? true : undefined}
      />
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button type="submit" size="sm" variant="default" disabled={adding || !url.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </InputGroup.Button>
      </InputGroup.Addon>
    </InputGroup.Root>
  </form>

  {#if problem}
    <Alert.Root variant="destructive">
      <span class="icon-[ic--round-error-outline] size-5"></span>
      <Alert.Description>{problem}</Alert.Description>
    </Alert.Root>
  {/if}

  <Separator />

  <section class="flex flex-col gap-2">
    <h2 class="text-xs uppercase tracking-wider text-muted-foreground">Up next</h2>

    {#if upNext.length === 0}
      <Empty.Root class="border border-dashed">
        <Empty.Header>
          <Empty.Media variant="icon">
            <span class="icon-[ic--round-queue-music] size-5"></span>
          </Empty.Media>
          <Empty.Title>Nothing queued yet</Empty.Title>
          <Empty.Description>Paste a YouTube link to start the night off.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul
        class="flex flex-col gap-2"
        use:dndzone={{
          items: upNext,
          flipDurationMs: 150,
          delayTouchStart: HOLD_TO_DRAG_MS,
          dropTargetStyle: {}
        }}
        onconsider={considering}
        onfinalize={dropped}
      >
        {#each upNext as track, index (track.id)}
          <li
            class="flex items-center gap-2 rounded-lg border bg-card p-2 text-card-foreground"
            animate:flip={{ duration: 150 }}
          >
            <span
              aria-hidden="true"
              class="icon-[ic--round-drag-indicator] size-5 shrink-0 cursor-grab text-muted-foreground"
            ></span>
            <img
              src={track.song.artworkUrl}
              alt=""
              class="h-10 w-[3.25rem] shrink-0 rounded object-cover"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{track.song.title}</p>
              <p class="truncate text-xs text-muted-foreground">
                {track.song.author} · {asMinutesAndSeconds(track.song.durationSeconds)} · added by {track.addedByNickname}
              </p>
            </div>
            <SaveToPlaylist
              songTitle={track.song.title}
              songId={track.song.id}
              playlists={room.playlists}
              onsave={save(track.song.id)}
            />
            {#if index > 0}
              <Button
                variant="secondary"
                size="icon-lg"
                onclick={() => room.playNext(track.id)}
                aria-label="Play {track.song.title} next"
              >
                <span class="icon-[ic--round-playlist-play] size-5"></span>
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon-lg"
              onclick={() => room.removeTrack(track.id)}
              aria-label="Remove {track.song.title}"
            >
              <span class="icon-[ic--round-close] size-5"></span>
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if room.history.length > 0}
    <section class="flex flex-col gap-1">
      <h2 class="text-xs uppercase tracking-wider text-muted-foreground">Already played</h2>
      <ul class="flex flex-col gap-1">
        {#each room.history as track (track.id)}
          <li class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-muted-foreground">
            <img
              src={track.song.artworkUrl}
              alt=""
              class="h-8 w-10 shrink-0 rounded object-cover opacity-50"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs" class:line-through={track.unplayableReason}>
                {track.song.title}
              </p>
              <p class="truncate text-[0.6875rem]">
                {#if track.unplayableReason}
                  {track.unplayableReason}
                {:else}
                  added by {track.addedByNickname}
                {/if}
              </p>
            </div>
            {#if track.unplayableReason}
              <span
                aria-hidden="true"
                class="icon-[ic--round-error-outline] size-4 shrink-0 text-destructive"
              ></span>
            {/if}
            <SaveToPlaylist
              songTitle={track.song.title}
              songId={track.song.id}
              playlists={room.playlists}
              onsave={save(track.song.id)}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if room.playlists.length > 0}
    <section class="flex flex-col gap-2">
      <h2 class="text-xs uppercase tracking-wider text-muted-foreground">Playlists</h2>
      <ul class="flex flex-col gap-2">
        {#each room.playlists as playlist (playlist.id)}
          <li class="flex items-center gap-2 rounded-lg border bg-card p-2 text-card-foreground">
            <span class="icon-[ic--round-queue-music] size-5 shrink-0 text-muted-foreground"></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{playlist.name}</p>
              <p class="truncate text-xs text-muted-foreground">
                {playlist.tracks.length}
                {playlist.tracks.length === 1 ? 'track' : 'tracks'} · started by {playlist.createdByNickname}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-lg"
              onclick={() => (renaming = { id: playlist.id, name: playlist.name })}
              aria-label="Rename {playlist.name}"
            >
              <span class="icon-[ic--round-edit] size-4"></span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onclick={() => room.loadPlaylist(playlist.id)}
              disabled={playlist.tracks.length === 0}
            >
              Add all
            </Button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<Dialog.Root open={renaming !== null} onOpenChange={(open) => !open && (renaming = null)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Rename playlist</Dialog.Title>
      <Dialog.Description>Anyone here can rename it.</Dialog.Description>
    </Dialog.Header>
    {#if renaming}
      <form onsubmit={commitRename}>
        <Field.FieldGroup>
          <Field.Field>
            <Field.FieldLabel for="rename">Name</Field.FieldLabel>
            <Input id="rename" bind:value={renaming.name} autocomplete="off" />
          </Field.Field>
          <Button type="submit" disabled={!renaming.name.trim()}>Rename</Button>
        </Field.FieldGroup>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
{/if}
