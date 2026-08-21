# Only the Player produces audio

The Room is a physical space with one speaker, not a group of people listening
apart. So exactly one device — the Player — resolves and plays audio, and every
other device is a Controller that shapes the Playlist and drives the Transport
but never plays a sound.

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
