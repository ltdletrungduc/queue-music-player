# queue-music-player

A shared music queue for a room of friends. One device — the **Player** — is
paired to the speaker and is the only thing that makes sound. Everyone else opens
the site on their phone as a **Controller**: they paste links, reorder the queue,
skip, pause and save what they liked, but no audio ever plays on their own phone.

See [CONTEXT.md](./CONTEXT.md) for the words this project uses, and
[docs/adr](./docs/adr) for the decisions that would otherwise look strange.

## Running a night

Everything runs on the machine plugged into the speaker.

**1. Set the two secrets.** Copy the example and choose your own values — the
server refuses to start without them, because starting unguarded and looking
fine is worse than not starting.

```bash
cp apps/server/.env.example apps/server/.env
```

`JOIN_CODE` is what friends type to get in. `PLAYER_PASSWORD` is what this
machine types to take the speaker. Keep them different: holding one must not
grant the other.

**2. Build and start.**

```bash
pnpm install
pnpm build
pnpm --filter @qmp/server start
```

The Room is now at `http://localhost:5858`.

**3. Open the speaker** at <http://localhost:5858/player>, enter the Player
password, and press *Start the speaker* once. Browsers will not make sound until
somebody asks, so this is the one unavoidable click of the evening.

**4. Let friends in.** On the same wifi, your machine's address on port 5858 is
enough. For phones on mobile data — or for the screen wake lock and media keys,
which browsers only allow on a secure origin — put it through a tunnel. Once:

```bash
brew install cloudflared
```

Then, each night:

```bash
cloudflared tunnel --url http://localhost:5858
```

That prints an `https://…trycloudflare.com` address. Give that to your friends
along with the join code. It changes each time you start it.

The tunnel points at one port because the server serves the site, the socket and
the audio from a single origin. That is deliberate: a tunnel terminates TLS on
one origin and knows nothing about a second port.

Two things stay on this machine however far the tunnel reaches: the speaker, and
the audio itself. A device elsewhere cannot claim the speaker even holding the
password, and the audio endpoint answers nothing that arrived through the tunnel.
Otherwise a Player somewhere else would drag every byte back out through this
machine's connection to reach a speaker nobody here can hear.

## Developing

```bash
pnpm dev          # server on :5858, site on :5173
pnpm test         # the reducer and the store, no network
pnpm typecheck
pnpm --filter @qmp/server test:contract   # talks to the real YouTube
```

Contract tests are kept out of the default run: they need a network and a
residential IP, and they fail when YouTube changes rather than when this repo
does. That is exactly what makes them worth running deliberately.
