# Queue Music Player

A shared playlist for a room of friends. One device plays the audio out loud
through a speaker; everyone else uses their phone to shape what plays next.
Nobody hears music through their own phone.

## Language

### The room

**Room**:
The single shared space that holds one Playlist, one Transport, and the
Controllers currently connected. There is exactly one for now, addressed as
`main`.
_Avoid_: Session, channel, party, lobby

**Join Code**:
The secret string that grants entry to the Room. Possession of it is the entire
authorisation model — there are no roles and no per-person permissions.
_Avoid_: Password, invite, token, PIN

**Player**:
The single device that holds the audio output — the laptop or phone paired to the
speaker. It is the only thing in the system that makes sound, and only one exists
at a time.
_Avoid_: Host, DJ, master, sink, output device

**Controller**:
A person connected to the Room from their own device, who can shape the Playlist
and drive the Transport but receives no audio. Controllers are not accounts; they
do not persist beyond the browser that created them.
_Avoid_: User, listener, member, guest, remote

**Nickname**:
The display name a Controller chooses on entry. Used to attribute actions ("Duc
skipped") — it carries no authority.
_Avoid_: Username, handle, display name

### What plays

**Playlist**:
The durable, ordered list of Tracks in the Room. Tracks are *not* consumed when
played; they stay in place and the Cursor moves past them.
_Avoid_: Queue, tracklist

**Track**:
One entry in the Playlist: a reference to a piece of audio at a Source, plus who
added it and where it sits in the order.
_Avoid_: Song, item, entry, media

**Cursor**:
The position in the Playlist that is currently playing or paused. "Next" and
"Previous" move the Cursor; they never remove a Track.
_Avoid_: Index, pointer, head, now-playing pointer

**Shuffle Order**:
An alternative traversal order over the Playlist, applied as a view. Turning
Shuffle off restores the Playlist's own order, which was never altered.
_Avoid_: Randomise, mix

**Transport**:
The Room's playback state — which Track, playing or paused, and how far in. The
Player owns it and reports it; Controllers request changes to it and display it.
_Avoid_: Player state, playback state, controls

### Where audio comes from

**Source**:
An external service a Track's audio originates from, such as YouTube, Audius, or
a direct file URL.
_Avoid_: Platform, provider, service, backend

**Source Provider**:
The adapter that knows how to validate a link against one Source and turn a Track
reference into a playable Stream.
_Avoid_: Connector, driver, integration

**Stream**:
A playable, time-limited audio URL resolved from a Track. Streams expire and are
re-resolved; a Track outlives every Stream made from it.
_Avoid_: Link, media URL, file

**Extractor**:
The service that resolves Tracks into Streams and relays the audio bytes to the
Player. It is the only part of the system that talks to a Source directly.
_Avoid_: Proxy, resolver, backend, API
