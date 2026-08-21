<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import type { Playlist } from '@qmp/shared';

  type Props = {
    songTitle: string;
    playlists: Playlist[];
    songId: string;
    onsave: (playlistId: string | null, newName: string | null) => void;
  };

  let { songTitle, playlists, songId, onsave }: Props = $props();

  let naming = $state(false);
  let newName = $state('');

  /** A name nobody has to think of at two in the morning. */
  const today = () =>
    new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  const alreadyHolds = (playlist: Playlist) => playlist.tracks.some((t) => t.song.id === songId);

  function startNaming() {
    newName = today();
    naming = true;
  }

  function createAndSave(event: SubmitEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    onsave(null, name);
    naming = false;
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon-lg" aria-label="Save {songTitle} to a playlist">
        <span class="icon-[ic--round-playlist-add] size-5"></span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content align="end">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>Save to</DropdownMenu.GroupHeading>
      {#each playlists as playlist (playlist.id)}
        <DropdownMenu.Item
          disabled={alreadyHolds(playlist)}
          onSelect={() => onsave(playlist.id, null)}
        >
          <span class="truncate">{playlist.name}</span>
          {#if alreadyHolds(playlist)}
            <Badge variant="secondary" class="ml-auto">already in</Badge>
          {/if}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Item onSelect={startNaming}>
        <span class="icon-[ic--round-add]"></span>
        New playlist…
      </DropdownMenu.Item>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<Dialog.Root bind:open={naming}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>New playlist</Dialog.Title>
      <Dialog.Description>Starting it with “{songTitle}”.</Dialog.Description>
    </Dialog.Header>

    <form onsubmit={createAndSave}>
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="playlist-name">Name</Field.FieldLabel>
          <Input id="playlist-name" bind:value={newName} autocomplete="off" />
          <Field.FieldDescription>Today's date, unless you think of better.</Field.FieldDescription>
        </Field.Field>
        <Button type="submit" disabled={!newName.trim()}>Create</Button>
      </Field.FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>
