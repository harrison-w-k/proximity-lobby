# Proximity Lobby

3D first-person lobby on a checkered floor with global text chat and proximity voice chat (max 20 players).

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

## Animal Battle Royale
The lobby is the front door to the game in `animal-battle-royale-gdd.md`. Press **B** (or the paw button) to pick one of eight
animals and queue; 25 s after the first player queues the match starts and AI animals fill the 20 slots.

- **Sim** (`shared/arena/`): `terrain.ts` (seeded 700 m map, biomes, lakes, Poisson-placed resources), `animals.ts` (8 animals, stats, 80+ skills),
  `mobs.ts` (4 horde tiers, swarms), `match.ts` (authoritative 30 Hz match: phases, lava rings, XP, combat, items, hunted mark, Gulag, Horde Leaders),
  `bots.ts`, `director.ts` (queue + match lifecycle). The server owns everything; the client only predicts its own steps (`move.ts`).
- **Client** (`client/src/arena/`): `scene.ts` (terrain, lava shader, instanced forests, animals, effects), `models.ts` (procedural animals),
  `hud.ts`, `arena.ts` (input, prediction, camera, proximity-voice rules), `menu.ts`.
- **Controls**: WASD move, Space dash (every animal, 2.4 s cooldown, costs stamina), Left Alt toggles a free cursor (click the upgrade panel / swarm choices), Shift sprint, C sneak (halves voice range), LMB attack, Q E R F skills, X harvest, G pick up / eat (leaders), V fill pouch,
  1-6 use item, Tab upgrade panel (1-5 spend, Z / X pick a skill). Leaders: 1 attack, 2 scatter, 3 guard, Q swarm skill.
- **Squads**: friends who type the same squad code on the menu share a team (max 4): no friendly fire, shared win.
- **Voice**: 10 m full / 40 m silent, 15 m for leaders, whisper when sneaking, muffled behind rocks/trees and underwater, separate Gulag channel.
- Matches run on both hosts (the Node server and the Cloudflare Durable Object, which stays awake while a queue or match is active). On Node, `MATCH_COUNTDOWN_MS` and `MATCH_BOTS=0` tune the queue.
- Tests: `npm test` runs a full 20-bot match headlessly (`shared/arena/match.test.ts [seed]`).
