<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';

  type Props = {
    title: string;
    description: string;
    /** The one secret this door asks for. */
    secretLabel: string;
    secretPlaceholder: string;
    secret: string;
    /** Present only on the door people walk through, not the one the speaker uses. */
    nickname?: string;
    knocking: boolean;
    refusal: string | null;
    onenter: (values: { secret: string; nickname: string }) => void;
  };

  let {
    title,
    description,
    secretLabel,
    secretPlaceholder,
    secret = '',
    nickname = undefined,
    knocking,
    refusal,
    onenter
  }: Props = $props();

  // Deliberately a starting point, not a binding: once someone is typing, what
  // was remembered is no longer what they mean.
  let secretDraft = $state(untrack(() => secret));
  let nicknameDraft = $state(untrack(() => nickname ?? ''));
  // Whether this door asks for a name at all — the speaker's does not.
  const wantsNickname = untrack(() => nickname) !== undefined;
  const ready = $derived(
    secretDraft.trim().length > 0 && (!wantsNickname || nicknameDraft.trim().length > 0)
  );

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!ready || knocking) return;
    onenter({ secret: secretDraft.trim(), nickname: nicknameDraft.trim() });
  }
</script>

<main class="flex min-h-dvh items-center justify-center px-4">
  <Card.Root class="w-full max-w-sm">
    <Card.Header>
      <Card.Title>{title}</Card.Title>
      <Card.Description>{description}</Card.Description>
    </Card.Header>

    <Card.Content>
      <form onsubmit={submit}>
        <Field.FieldGroup>
          <Field.Field data-invalid={refusal ? true : undefined}>
            <Field.FieldLabel for="secret">{secretLabel}</Field.FieldLabel>
            <Input
              id="secret"
              bind:value={secretDraft}
              type="password"
              autocomplete="off"
              placeholder={secretPlaceholder}
              aria-invalid={refusal ? true : undefined}
            />
            {#if refusal}
              <Field.FieldError>{refusal}</Field.FieldError>
            {/if}
          </Field.Field>

          {#if wantsNickname}
            <Field.Field>
              <Field.FieldLabel for="nickname">Your name</Field.FieldLabel>
              <Input
                id="nickname"
                bind:value={nicknameDraft}
                autocomplete="off"
                placeholder="What should we call you?"
              />
              <Field.FieldDescription>
                Shown against every Track you add. Two of you can share a name.
              </Field.FieldDescription>
            </Field.Field>
          {/if}

          <Button type="submit" size="lg" class="w-full" disabled={!ready || knocking}>
            {knocking ? 'Knocking…' : 'Go in'}
          </Button>
        </Field.FieldGroup>
      </form>
    </Card.Content>
  </Card.Root>
</main>
