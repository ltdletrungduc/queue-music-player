# Only the Player produces audio

The Room is a physical space with one speaker, not a group of people listening
apart. So exactly one device — the Player — resolves and plays audio, and every
other device is a Controller that shapes the Playlist but never plays a sound.

The Transport belongs to the Player as well. A Controller shapes what comes next
— adding, reordering, removing — but does not start, stop or skip what is
sounding now, and does not set the volume. The speaker is a physical thing with
someone standing beside it, and that person is the one placed to judge whether
the music should stop.

We first designed this as a synchronised listening room, where every device
played the same track at the same instant. Abandoning that removed the hardest
part of the system: there is no shared clock, no server time offset, no drift
correction, and no per-device autoplay grant to negotiate. It also cut audio
bandwidth by the number of people in the room, and reduced "a Controller woke
from sleep" from a resynchronisation problem to a state refetch.

The cost is that the Room is silent whenever no Player is connected, and a
Controller cannot be promoted to cover for one — a phone in someone's pocket is
not attached to the speaker, so promoting it would produce silence and
confusion rather than music.
