# The Extractor runs beside the Player, on a residential connection

YouTube serves audio over SABR: the player response carries a single
server-side adaptive streaming endpoint and no per-format URL. Segments are
requested by POST and framed in a protobuf-based protocol, so no media element
can fetch them. Every InnerTube client behaves this way, and the extraction
libraries that relied on plain URLs fail outright.

The Extractor therefore speaks SABR itself and relays the resulting audio to the
Player as an ordinary HTTP response. It runs on the same machine and public IP
as the Player, which is a laptop on a home connection, because resolving from a
datacenter IP triggers bot verification after roughly 5-10 requests, with no
option that avoids it.

Client-side extraction was ruled out first: the media host only permits the
YouTube origin, so a browser cannot resolve a stream by itself. A server process
is unavoidable; the decision is only whose IP it uses.

The Extractor must evaluate YouTube's player script to decipher the streaming
endpoint — passing it undeciphered returns 403, and the library ships no
interpreter. That script is untrusted remote code and is evaluated in an
isolated VM context with a timeout, never in the server's own scope.

Consequence: audio bytes pass through the Extractor. While the Extractor and the
Player share a machine this is a loopback copy and costs nothing. Moving the
Extractor to a hosted server later would make it a real bandwidth cost, on top
of reintroducing the datacenter IP problem — so that move is more expensive than
it first appears, not less.

## Superseded reasoning

An earlier revision of this record claimed the Player's browser could point an
audio element straight at a resolved URL, so that nothing was ever proxied. A
spike disproved it: plain URLs no longer exist. The residential-IP requirement
survived that spike unchanged; the no-proxying claim did not.
