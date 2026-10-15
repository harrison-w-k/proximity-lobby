# Proximity Lobby

3D first-person multiplayer lobby with global text chat and proximity voice chat (max 20 players).

## Look and feel
- Chunky low-res retro 3D: it renders at ~320 rows and is upscaled with nearest-neighbour (`PIXEL_ROWS` in `client/src/world.ts`), with a faint scanline + vignette overlay and blue dialog-box style UI.
- The map is a flat blue-and-white checkered tile floor under a starry night sky with fog (`client/src/environment.ts`). No buildings yet; `boxes`/`discs` there are the hook for static colliders when the map grows.
- Players are faceless clay mannequins (`client/src/avatar.ts`): jointed skeleton, smooth walk/sprint/idle blending driven by actual movement speed, and a talking gesture + glow while speaking.
- Player-to-player and static collisions live in `client/src/collision.ts` (with tests).

## Run locally
    npm install
    npm run dev        # client http://localhost:5173, server :3000

## Production (single process serves client + websocket)
    npm run build && npm start     # PORT env var respected; Dockerfile included

Needs HTTPS in production (browsers block the mic otherwise). Deploy anywhere that supports
long-lived WebSockets (Fly.io, Railway, Render) — not serverless functions.
For players behind strict NATs, set `TURN_URL` (comma-separated), `TURN_USERNAME`, `TURN_CREDENTIAL`.

## Controls
WASD move · Shift sprint · mouse look · Enter chat · M mute

## Usernames
Players type their email on the join screen; the username is the part before the `@` (lowercased, `+tags` removed,
max 16 chars, de-duplicated by the server as `name_2`). The email stays in the browser and is not sent to the server.
It is **unverified** until Supabase Auth (magic link) is added, so anyone can claim any name for now.

## Collisions
Players are solid circles (0.4 m radius). Collision is client-side (`client/src/collision.ts`), so it's cooperative, not cheat-proof.

## Supabase (planned)
`client/src/supabase.ts` is an inert stub. See `.env.example`.

## Deploy on Railway
`railway.json` + `Dockerfile` are all it needs. New Project -> Deploy from GitHub repo -> pick this repo, then
Settings -> Networking -> Generate Domain. Railway sets `PORT` automatically; HTTPS and WebSockets work out of the box.
