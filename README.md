# Refineder 8-Ball

A top-down pool table for the Refineder lounge in [UTECS City](https://utecs.net/city).
It uses the [original MIT-licensed Pool by Arel Kair](https://github.com/arelkair/pool)
and retains the original [sound credits](public/sfx/CREDITS.txt).

## Play

Refineder members can select **Billiards** from Games to go to the lounge table.
Use **Play 8-Ball** at the table. Practice is solo and multiplayer is for two
players. Create a room and share its four-character code with a teammate.
Drag from the cue ball and release to shoot. The longer the drag, the stronger
the shot.

Online matches have an open table after the break, solids and stripes, and
ball in hand after a foul. The eight ball is spotted if pocketed on the break.
Pocketing it early or scratching while pocketing it loses the game. Rooms live
in memory and end when either player leaves. The host's browser and the guest's
browser both receive the table and score from the room server.

## Run

Use Node.js 24 and `npm ci`. Run `npm test` for cue physics, room rules and
HTTP/WebSocket admission, and `npm run build` to build the client for
`/games/pool/`.

Start the room server with `npm start` after building. It listens on port 3001
unless `PORT` is set. Set `POOL_PUBLIC_ORIGIN` to the city's origin and
`POOL_ACCESS_URL` to its verified city-session membership route
(`/api/v1/city/pool/access`). The reverse proxy must forward
`/games/pool/` and upgrade `/games/pool/ws` at that same origin. The server
checks membership on each page and asset request, when a socket opens, and
while it stays connected. `/games/pool/health` serves the process probe.
