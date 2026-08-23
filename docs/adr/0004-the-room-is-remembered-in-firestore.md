# The Room is remembered in Firestore, and never waited for

The Queue, Now Playing, History and Playlists live in one Firestore document,
`rooms/main`. The reducer in memory is still what the Room *is* and socket.io is
still how it reaches Controllers; Firestore replaces the SQLite file that used to
survive a restart, and nothing else.

This is persistence, not state sync. Clients do not read Firestore. The Room
already broadcasts over a socket on the same machine, and routing that through a
datacenter would put a round trip in front of every Queue change to replace
something that is fast because it is local.

What was actually being bought is a place to *look at* the Room, and to correct
it, when a night ends with a Track wedged in Now Playing or a Playlist with
something odd in it. Under SQLite that meant a `sqlite3` prompt on the machine
plugged into the speaker. A read-only view of the old store would have been a
much smaller change and was considered first; it was dropped because it answers
"see the state" and not "fix it", and because a database to install and keep was
itself part of what was being removed.

## Why dispatch stayed synchronous

`dispatch` reduces a Command and writes the result in the same breath, and every
socket handler in `index.ts` calls it without waiting. Firestore cannot be
written in that breath, so either `dispatch` became async — rippling out into
every handler — or writes moved behind it.

They moved behind it. None of those handlers has anything useful to do with a
write's outcome, so making them all `await` would have spread asynchrony through
the whole transport to carry back a result nobody reads. The Effects contract is
untouched: a Command still goes in and an array of Effects still comes straight
back out.

The cost is stated rather than hidden: what is on screen may be a moment ahead of
what is stored.

Because every save is the whole Room, buffering is coalescing. Three reorders in
a second are one write of the third, not three writes in a queue. A failed write
is kept and retried, and anything newer arriving meanwhile replaces it — retrying
the stale one would undo the part of the night that happened while the connection
was away.

Reading is the one thing that is waited for. The Room is loaded once, before
anything is served, so `createRoomRuntime` is async and nothing after it is.

## Why one document

There are no tables and no join, so a Song is written wherever the Track holding
it is written. That duplicates a little text and removes the row that had to be
kept alive for whichever list still pointed at it. History no longer needs a rank
column to remember it is most recent first, because an array remembers its own
order.

It is also the shape somebody can read in the console: `queue`, `nowPlaying`,
`history`, `playlists`, `position`.

Reading it back is deliberately forgiving. The point of putting the Room where it
can be corrected by hand is that it will be corrected by hand, so a field that is
missing, or replaced by something that is not a Track, costs that entry rather
than the evening. The same tolerance is what opens a Room written before a field
existed, which is the job `addMissingColumns` used to do.

Where a table used to promise something, the mapping promises it. A Song appears
in a Playlist at most once: a `UNIQUE` constraint said so, and now `toDocument`
refuses the write. The reducer already declines to add a duplicate — this is the
backstop behind it, kept where the schema used to be.

## Why the position is throttled

The Player reports where the audio has reached once a second. Writing that every
time is 18,000 writes across a five-hour night, most of a day's free tier spent
on a number nothing reads until a restart. It is written at most every five
seconds instead, which is 3,600, and means a restart may replay up to five
seconds of a Track.

The position also records which Track it was measured in. A position is written
far more often than the Room is, so a stale one is always lying around by the
time a Track changes, and without the Track's name the next Track would inherit
it. That is what the old `position_seconds` column on the track row gave for
free.

## What it cost

**Startup now needs the internet.** If Firestore cannot be reached when the
server starts, it stops rather than starting: coming up with an empty Room would
show everyone an empty Queue and then write that emptiness over the real one.
This is a real regression from a file on disk, which was always readable.

**Nothing after startup needs it.** A connection that drops mid-night costs the
record of the night, not the night. The music keeps playing, the Queue keeps
being shaped from phones on the wifi, and the buffered write retries until the
line comes back. If the process dies while the connection is away, whatever had
not been written is gone — which is also why `SIGINT` now waits briefly for the
buffer before exiting.

**Latency.** A local write was microseconds; a round trip is tens of
milliseconds. Because nothing waits for it, this is invisible on screen. It only
widens the window in which a crash loses the last change.

**The Queue leaves the machine.** Track titles and Nicknames are now data held by
Google. Small, but it is a change from nothing leaving at all. The audio and the
speaker still do not leave — see ADR-0001 and ADR-0002.

**Setup.** This used to be `cp .env.example .env`. It is now that plus a Google
account, a project, and a service account key, with the Firestore emulator
covering development at the price of installing it. This is the cost that is
hardest to argue is worth paying, and it was paid knowingly.

Keeping both stores behind the new interface would have avoided most of that. It
was rejected because nobody asked for two stores, and two stores is two things to
keep working.
