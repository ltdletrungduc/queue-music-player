# The Extractor runs beside the Player, on a residential connection

The Extractor asks InnerTube what a video is, picks a middling audio-only
format — a speaker in a room, not headphones — deciphers its URL, and reads it a
range at a time, relaying the bytes to the Player as an ordinary HTTP response. Nothing is written to disk: a range is read
and handed on, and the audio is never anywhere but in flight.

It runs on the same machine and public IP as the Player, which is a laptop on a
home connection, because resolving from a datacenter IP triggers bot
verification after roughly 5-10 requests, with no option that avoids it.

Client-side extraction was ruled out first: the media host only permits the
YouTube origin, so a browser cannot fetch the audio by itself. A server process
is unavoidable; the decision is only whose IP it uses.

## Why not the web client, and not SABR

The web player response carries no per-format URL — only a single server-side
adaptive streaming endpoint, whose segments are requested by POST and framed in
a protobuf-based protocol. Speaking that protocol is possible, and the Extractor
used to. It no longer works: YouTube answers every such request with
`attestation pending` and stops sending audio a couple of minutes in, whatever
the video. Attestation wants a proof-of-origin token minted by YouTube's own
bot-detection code, which is not something this project is going to run.

The other InnerTube clients still answer with a URL per format, and those URLs
still serve audio without attestation. The Extractor asks as one of them.

That is a bet on YouTube leaving one non-web client alone, and it will need
revisiting when they do not — which is the same bet as before, at a different
place. What makes it the cheaper bet is that being wrong is a client name and a
format choice, rather than a protocol implementation.

## Why ranges

A single open-ended GET on one of those URLs is paced by YouTube at roughly
twice real time. That is fast enough to play and far too slow to be safe: a
Track has almost no buffer to survive a hiccup on, and nothing says the pacing
will stay that generous. Ranged requests are not paced at all — the same audio
arrives about eighty times faster.

Ranges are asked for one after another rather than all at once, so the Extractor
reads at the speed the Player consumes. An hour-long Song therefore costs no
more memory than a short one, and a Song skipped after ten seconds costs ten
seconds of somebody's bandwidth rather than an hour of it.

## What it cost

Time to first byte is what this is felt through: it is paid every time somebody
adds a Song to an empty Queue. Measured on the machine this runs on, from asking
the Source for a Stream to the first byte arriving:

| | time to first byte |
|---|---|
| SABR, as it was | ~800ms, then failed part way through |
| yt-dlp piped to stdout | 1.6-2.7s, depending on which clients it tried |
| ranges, as built | 0.7-1.2s |

So the cost is a fraction of a second, against a path that did not finish a
Track at all. That is why yt-dlp was not taken, despite it tracking YouTube's
changes better than anything else.

Once past the first byte the audio arrives far faster than it is consumed: a
72-minute Track is 70MB and takes about three seconds to read end to end.

## Why the player script is still evaluated

The URL is deciphered before use — undeciphered it returns 403 — and its
throttling parameter is unscrambled at the same time, or YouTube paces what it
sends regardless of ranges. Both are the doing of YouTube's player script, which
youtubei.js ships no interpreter for. That script is untrusted remote code and
is evaluated in an isolated VM context with a timeout, never in the server's own
scope.

## Consequences

Audio bytes pass through the Extractor. While the Extractor and the Player share
a machine this is a loopback copy and costs nothing. Moving the Extractor to a
hosted server later would make it a real bandwidth cost, on top of reintroducing
the datacenter IP problem — so that move is more expensive than it first
appears, not less.

A Song whose format does not say how many bytes it is cannot be played at all.
There is no way to ask for a range without a length, and no way to tell audio
that ended from audio that was cut off. The Extractor refuses it rather than
guessing; every format seen so far says.

A Stream that stops short of the length the format promised is failed, not
closed. Closing it would hand the Player a truncated file it cannot tell from a
whole one, so it would report the Track finished and move on part way through;
failing is what reaches the Room's retry.

## Superseded reasoning

An earlier revision of this record claimed the Player's browser could point an
audio element straight at a resolved URL, so that nothing was ever proxied. A
spike disproved it: the media host only answers the YouTube origin.

A later revision claimed plain per-format URLs no longer existed anywhere, and
that every InnerTube client behaved the same way. That was true of the web
client and read as true of all of them; it was not. The claim survived as long
as it did because the Extractor only ever asked as the web client, so there was
nothing to contradict it. The residential-IP requirement has survived both
spikes unchanged.
