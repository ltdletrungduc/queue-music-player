# The Queue is consumed; saved Playlists are separate

A Track leaves the Queue when it starts playing and moves into Now Playing, then
into History. The Queue holds only what has not played yet.

We first modelled this as a durable list with a moving cursor, because Repeat All
and Previous need somewhere to go back to. Dropping Repeat and Shuffle removed
most of that need, and consumption turned out to describe how people behave
around a speaker: you queue a song, it plays, it is done. It also makes the
playing Track structurally unremovable rather than a permission check — nobody
can delete it because it is not in any list. Previous is served by History
instead of by a cursor.

The word "Playlist" is therefore free to mean something genuinely different: a
saved, single-owner collection that is *copied* into the Queue when loaded, and
which nothing that happens during a session can modify.

Consequence: reintroducing Repeat All means refilling the Queue from History,
which is real work. Under the cursor model it would have been nearly free.
