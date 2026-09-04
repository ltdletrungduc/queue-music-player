<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  /**
   * A Song's artwork, or a stand-in for it.
   *
   * Not every Source has a picture to offer — a direct audio link is a file and
   * nothing more — and an empty `src` renders as a broken image, which reads as
   * something having gone wrong rather than as there being nothing to show.
   */
  let { src, class: className }: { src: string; class: ClassValue } = $props();
</script>

{#if src}
  <img {src} alt="" class={['object-cover', className]} />
{:else}
  <div
    class={[
      'flex items-center justify-center bg-muted text-muted-foreground',
      className
    ]}
  >
    <span aria-hidden="true" class="icon-[ic--round-music-note] size-1/2"></span>
  </div>
{/if}
