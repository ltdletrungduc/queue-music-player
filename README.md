# queue-music-player

A shared music queue for a room of friends. One device — the **Player** — is
paired to the speaker, is the only thing that makes sound, and is the only thing
that starts, stops or skips it. Everyone else opens the site on their phone as a
**Controller**: they paste links, reorder the queue, and save what they liked,
but no audio ever plays on their own phone.

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

## Using it

### At the speaker

Open `/player` on the machine wired to the speaker, enter the Player password,
and press **Start the speaker** once. Browsers will not make sound until somebody
asks, so this is the one unavoidable click of the evening.

That screen is meant to be read from across a room. It shows the artwork, the
title, who added it, how far through it is, and what is up next. Its controls are

| | |
|---|---|
| **⏮ Previous** | back to the Track before this one |
| **⏯ Play / Pause** | stops the sound; the Room remembers what it wanted |
| **⏭ Next** | done with this one, move on |
| **Volume** | the app's own level, for when the speaker's dial is across the room |

The machine's media keys and lock screen work too, and the screen is kept awake
while music is playing so a laptop left alone does not dim mid-song.

Everything that starts, stops or skips the music lives here and nowhere else. The
speaker is a physical thing with somebody standing beside it, and that person is
the one placed to judge whether the music should stop. See
[ADR-0001](./docs/adr/0001-only-the-player-produces-audio.md).

### From a phone

Open the site, type the join code and a name. The name is shown against every
Track you add, and two of you can share one.

- **Add** by pasting a YouTube link into the box. Adding to an empty Queue starts
  the music on its own — there is nothing to press.
- **Reorder** by dragging. Hold a moment first on a touchscreen, so scrolling the
  list does not pick a Track up by accident.
- **Play next** jumps one Track to the front without disturbing the rest.
- **Remove** takes a Track out of the Queue.
- **Save** keeps a Song in a Playlist to load another night.

A phone cannot pause, skip or change the volume, and cannot be the speaker even
holding the Player password. If nothing is attached to the speaker the Queue says
*Nobody's playing* — keep queuing, it will be there when a Player arrives.

## Developing

### Starting the dev server

Once, to set up:

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
```

Then open `apps/server/.env` and fill in `JOIN_CODE` and `PLAYER_PASSWORD`. The
server will not start without both, and it says so rather than coming up
unguarded.

Then, every time:

```bash
pnpm dev
```

That starts two things at once and prefixes their output `[server]` and `[web]`:

| | |
|---|---|
| `:5858` | the server — the socket, the audio, the database |
| `:5173` | Vite serving the site, with hot reload |

Open the Queue at <http://localhost:5173> and the speaker at
<http://127.0.0.1:5173/player>. Both reload on save. `Ctrl-C` stops the pair.

If `:5858` reports `EADDRINUSE`, an older server is still holding it — find it
with `lsof -nP -iTCP:5858 -sTCP:LISTEN` before killing anything, since a built
server started for a real night looks much the same from the outside.

### Running it on localhost

Development is the one place the Room is **two** origins rather than one. Vite
serves the site on `:5173` and the server keeps the socket and the audio on
`:5858`, because serving a build from last night alongside a live edit is a slow
thing to work out. The site knows to look next door on `:5858` while Vite is
serving it.

Open the Queue at <http://localhost:5173> and the speaker at
<http://127.0.0.1:5173/player>.

Use `127.0.0.1` for the Player, not `localhost`. Only the machine wired to the
speaker may take it, and that is judged by the address the socket arrives from:
a loopback address passes, anything else does not. `localhost` can resolve to
IPv6 `::1`, which the server does not listen on, so the page loads and the
socket then fails on its own. `127.0.0.1` avoids the question.

### Letting a phone in while developing

Vite already listens on every interface, so the site is at your machine's LAN
address on `:5173`. **Both ports have to be reachable** — the page comes from
`:5173` and its socket goes to `:5858`. Opening only `:5173` gives a page that
loads and then sits at *Knocking…* forever, which looks like a wrong join code
and is not one.

That address is plain HTTP, which is not a secure context, so the wake lock and
the media keys stay off until you go through the tunnel. Production has neither
problem: one origin, one port, HTTPS.

The Player still has to be opened on this machine. A phone on the same wifi can
be a Controller, never the speaker.

### Checks

```bash
pnpm test         # the reducer and the store, no network
pnpm typecheck
pnpm --filter @qmp/server test:contract   # talks to the real YouTube
```

Contract tests are kept out of the default run: they need a network and a
residential IP, and they fail when YouTube changes rather than when this repo
does. That is exactly what makes them worth running deliberately.
