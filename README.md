# Pacific Harbor Aquarium (proximity lobby)

3D first-person lobby set at a night-time California waterfront plaza and a small public aquarium, with global text chat and proximity voice chat (max 20 players).

## Look and feel
- Chunky low-res retro 3D (renders at ~320 rows and is upscaled with nearest-neighbour), starry night sky, fog, blue-tiled checkered floors, fluorescent strips, glowing tanks, saturated mural art.
- Everything is generated in code (`client/src/aquarium.ts`), with no image files. Original art. A fan tribute to Pacific-coast ocean-education centres and is not affiliated with any real aquarium.
- Players are faceless clay mannequins (`client/src/avatar.ts`): jointed skeleton, smooth walk/sprint/idle blending driven by actual movement speed, and a talking gesture + glow while speaking.
- Aquarium solids (walls, tanks, pillars) are colliders (`client/src/collision.ts`).


- **Client**: Vite + TypeScript + Three.js (`client/`)
- **Server**: Node + `ws` — lobby state, chat, and WebRTC signaling (`server/`)
- **Voice**: peer-to-peer WebRTC mesh; each voice is spatialised with Web Audio (`client/src/voice.ts`)
  - full volume within 3 m, linear fade to silence at 30 m (`shared/protocol.ts`)

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
