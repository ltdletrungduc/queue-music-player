# Queue Music Player

A shared music queue for a room of friends. One device plays the audio out loud
through a speaker; everyone else uses their phone to shape what plays next.
Nobody hears music through their own phone.

## Language

### The room

**Room**:
The single shared space that holds one Queue, one Transport, and the
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
A person connected to the Room from their own device, who can shape the Queue
and drive the Transport but receives no audio. Controllers are not accounts; they
do not persist beyond the browser that created them.
_Avoid_: User, listener, member, guest, remote

**Nickname**:
The display name a Controller chooses on entry. Used to attribute actions ("Duc
skipped") — it carries no authority.
_Avoid_: Username, handle, display name

### What plays

**Queue**:
The ordered list of Tracks waiting to play tonight. Shared and editable by every
Controller, and *consumed*: a Track leaves the Queue when it starts playing. The
same Track may appear in it any number of times.
_Avoid_: Playlist, tracklist

**Now Playing**:
The single Track currently sounding, held in its own slot outside the Queue. It
cannot be removed or reordered — only skipped — because it is no longer part of
any list. A Room with nothing in Now Playing is idle.
_Avoid_: Current track, head, active track

**History**:
The Tracks that have already played, most recent first. Previous draws from it;
nothing else does.
_Avoid_: Recently played, log, past

**Playlist**:
A saved, durable collection of Tracks, attributed to whoever created it but
editable by anyone in the Room. A Track appears in a Playlist at most once.
Loading a Playlist *copies* its Tracks into the Queue; the two are independent
from that moment on, so nothing that happens tonight can change a saved
Playlist.
_Avoid_: Album, collection, saved queue, preset

**Song**:
A piece of audio at a Source, independent of anywhere it appears. Two Tracks of
the same Song, whether in the Queue or in different Playlists, refer to one
Song.
_Avoid_: Media, video, recording, audio

**Track**:
One entry in a Queue or a Playlist: a reference to a Song, plus who added it and
where it sits in the order. A Track is where a Song appears; it is never the
Song itself.
_Avoid_: Item, entry, media

**Transport**:
The Room's playback state — what is in Now Playing, whether it is playing or
paused, and how far in. The Player owns it and reports it; Controllers request
changes to it and display it.
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
The audio of a Song, as bytes the Player can play. Resolved afresh whenever it
is needed and never stored; a Song outlives every Stream made from it.
_Avoid_: Link, URL, file, download

**Extractor**:
The service that resolves Tracks into Streams for the Player. It is the only part
of the system that talks to a Source directly; audio itself never passes through
it.
_Avoid_: Proxy, resolver, backend, API
