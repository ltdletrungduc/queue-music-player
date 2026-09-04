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
marks the Track unplayable. A direct `src` fails inside the audio element
instead, with the host's CORS policy and the browser's mixed-content rules as
new ways for it to fail, and none of that reaches the Room's retry as it stands.

And the audio endpoint is gated by a per-connection ticket and refuses anything
that is not this machine. A direct `src` is outside that gate. Nothing terrible
follows — the URL was public to begin with — but "the speaker plays what the
Room hands it" stops being true of every Song, and the exception is the kind of
thing that is forgotten later.

So the choice was one path against none, and one path won.

## What it cost

The bytes of a direct-link Song pass through this process. ADR-0002 already
accepts that cost for YouTube and for the same reason it is small: the Extractor
and the Player share a machine, so it is a loopback copy.

Unlike YouTube, the audio is fetched as one open request rather than a range at
a time. Ranges exist because YouTube paces a single GET at roughly twice real
time; an ordinary file server does not, so asking for the whole file is both
simpler and faster.

## Consequences

A Song whose length cannot be read is queued anyway, where ADR-0002 refuses the
YouTube equivalent. That is not a change of mind: YouTube's refusal exists
because a range cannot be asked for without a length, and this Source asks for
no ranges. The cost is that such a Song shows `0:00` for its whole play, because
nothing reports a length back once the audio is open.

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
the YouTube Source never had, and it is why a loopback, link-local, or private
address is refused before anything is fetched.

The check is made at every hop of every fetch, not once at the paste. Redirects
are followed by hand rather than left to `fetch`, because a host that is
perfectly public can answer `302` pointing at the home router; and the playing
read is checked as well as the describing one, because a Song saved in a
Playlist is fetched again every night it is played, long after the paste that
admitted it.

The addresses themselves are a written list — loopback, link-local, the private
ranges, carrier-grade NAT, and their IPv6 spellings — kept as a list rather than
one expression because both faults found in it so far were missing entries
rather than wrong ones.

What still gets through is a name that resolves to a private address: the check
reads addresses, not DNS. Closing that means resolving the name here and pinning
the connection to the address that came back, which is worth doing if this ever
runs anywhere but a laptop at a party.
