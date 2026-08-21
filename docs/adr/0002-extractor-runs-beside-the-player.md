# The Extractor runs beside the Player, on a residential connection

Stream URLs are bound to the IP that resolved them: a URL resolved elsewhere
returns 403 to the Player. And since 2025, resolving from a datacenter IP —
any VPS or cloud host — triggers bot verification after roughly 5–10 requests,
with no flag or option that avoids it.

Both problems disappear if the Extractor runs on the same machine and public IP
as the Player, which is a laptop on a home connection. The browser can then
point an `<audio>` element straight at the resolved URL: same IP, so no 403, and
cross-origin media playback needs no CORS headers. Nothing is proxied through a
server, so there is no bandwidth cost and no hosting AUP to violate.

Client-side extraction was ruled out first: `googlevideo.com` only permits the
`youtube.com` origin, so a browser cannot resolve a Stream by itself. A server
process is unavoidable — the decision is only *whose* IP it uses.

Consequence: the Extractor's location is configuration, not architecture. It sits
behind an HTTP boundary even while running locally, so moving it to a hosted
server later is a URL change. Doing so reintroduces both problems above and would
require a residential proxy subscription to solve them.
