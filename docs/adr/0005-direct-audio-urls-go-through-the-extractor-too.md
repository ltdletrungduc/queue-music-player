# Direct audio URLs go through the Extractor too

A Song from a direct audio link could be played straight from its own host. The
constraint that forces YouTube through the Extractor — the media host only
answers the YouTube origin, so the browser cannot fetch the bytes itself
(ADR-0002) — does not apply to an arbitrary file server. The Player's audio
element could point at the pasted URL and nothing would sit in between.

It does not. Every Song is played from `/stream/:songId`, whichever Source it
came from.

## Why

The Player builds one `src` for whatever is in Now Playing. Playing some Songs
directly means the Player has to know which kind it is holding, which is a
second code path through the part of the system that is hardest to test — it is
verified by hand, in a browser, next to a speaker.

It would also be a second way for a Song to fail. Today a Song that cannot be
opened is a 502 from this server, which the Player already retries once and then
marks unplayable (story 31). A direct `src` fails inside the audio element
instead, with the host's CORS policy and the browser's mixed-content rules as
new ways for it to fail, and none of that reaches the Room's retry as it stands.

And the audio endpoint is gated by a per-connection ticket and refuses anything
that is not this machine. A direct `src` is outside that gate. Nothing terrible
follows — the URL was public to begin with — but "the speaker plays what the
Room hands it" stops being true of every Song, and the exception is the kind of
thing that is forgotten later.

So the choice was one path against none, and one path won.

## What it costs

The bytes of a direct-link Song pass through this process. ADR-0002 already
accepts that cost for YouTube and for the same reason it is small: the Extractor
and the Player share a machine, so it is a loopback copy.

Unlike YouTube, the audio is fetched as one open request rather than a range at
a time. Ranges exist because YouTube paces a single GET at roughly twice real
time; an ordinary file server does not, so asking for the whole file is both
simpler and faster.

## Consequences

A direct-link Stream that ends before the host's `Content-Length` is failed
rather than closed, exactly as ADR-0002 requires of a YouTube one and for the
same reason: the Player cannot tell a truncated file from a whole one, so
closing it would have the Room move on part way through the Song. A host that
sends no length leaves nothing to check against, and such a Song is taken as it
comes.

Seeking within a direct-link Song is not supported, because the endpoint does
not answer ranged requests. Nothing asks it to today — the Room has no scrub
control, and Previous restarts a Track rather than seeking inside it — so this
is a limit to remember rather than a bug to fix. It applies equally to YouTube.

The server fetches whatever address a Controller pasted. That is a capability
the YouTube Source never had, and it is why the direct provider refuses hosts
that name a loopback, link-local, or private address before it fetches anything.
That check reads the address as written and does not resolve names, so a
hostname pointing at a private address still gets through. Closing that properly
means resolving the name and pinning the connection to the address that came
back, which is worth doing if this ever runs anywhere but a laptop at a party.
