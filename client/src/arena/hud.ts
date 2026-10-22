// The match HUD: bars, skills, inventory, minimap, banners, the upgrade panel and the end screen.
import { ANIMAL_BY_ID, CLASS_BY_ID, STAT_KEYS, STAT_NAMES, UNLOCK_LEVELS, type AnimalDef, type Skill, type StatKey } from '../../../shared/arena/animals';
import { SWARMS } from '../../../shared/arena/mobs';
import type { Global, InvItem, RosterEntry, YouState } from '../../../shared/arena/proto';
import { MAP_RADIUS, Biome, type Terrain } from '../../../shared/arena/terrain';

const CSS = `
#br-root, #br-menu {
  --bark: #241810; --bark2: #3a271a; --bark3: #5a3d24; --ink: #120c07; --moss: #4f8a3a; --leaf: #9bd15a; --amber: #f3b43c;
  --cream: #f7edd3; --blood: #d9503a; --river: #3fa5cf; --font: 'Fredoka', 'Trebuchet MS', 'Segoe UI', sans-serif;
  font-family: var(--font); letter-spacing: .01em;
}
#br-root { position: fixed; inset: 0; z-index: 7; pointer-events: none; color: var(--cream); font-size: 18px; }
#br-root[hidden] { display: none; }
/* carved-wood panel used everywhere */
.wood { background: repeating-linear-gradient(92deg, rgba(255,255,255,.025) 0 3px, rgba(0,0,0,.05) 3px 7px), linear-gradient(#3d2a1c, #271910);
  border: 3px solid var(--ink); border-radius: 14px; box-shadow: inset 0 0 0 2px #6e4c2d, inset 0 3px 0 rgba(255,255,255,.14), 0 5px 0 rgba(0,0,0,.45); color: var(--cream); }
.br-btn { font-family: var(--font); font-weight: 700; font-size: 20px; color: #17210c; background: linear-gradient(#b7e46f, #6faa3a); border: 3px solid var(--ink); border-radius: 999px;
  padding: 7px 20px; cursor: pointer; box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 4px 0 var(--ink); text-shadow: 0 1px 0 rgba(255,255,255,.4); }
.br-btn:hover:not(:disabled) { filter: brightness(1.1); }
.br-btn:active:not(:disabled) { transform: translateY(3px); box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 1px 0 var(--ink); }
.br-btn:disabled { opacity: .5; cursor: default; }
.br-btn.amber { background: linear-gradient(#ffd77a, #e09a1f); }
.br-btn.red { background: linear-gradient(#ff9c86, #d4412a); color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.4); }
.br-btn.wood { background: linear-gradient(#7a5a3a, #52381f); color: var(--cream); text-shadow: 0 1px 0 rgba(0,0,0,.5); box-shadow: inset 0 2px 0 rgba(255,255,255,.25), 0 4px 0 var(--ink); }

.br-top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 7px; }
.br-phase { display: flex; gap: 14px; align-items: center; padding: 6px 20px; font-weight: 700; font-size: 20px; letter-spacing: .08em; text-transform: uppercase; }
.br-phase b { color: var(--amber); font-weight: 700; font-size: 26px; letter-spacing: .02em; }
.br-phase span:first-child::before { content: '🍃'; margin-right: 6px; }
.br-ring { font-size: 20px; font-weight: 600; padding: 3px 18px; border-radius: 999px; background: rgba(18,12,7,.8); border: 2px solid #6e4c2d; text-shadow: 0 2px 0 var(--ink); }
.br-ring.warn { background: linear-gradient(#e2573a, #a82a14); border-color: #3a0e06; animation: brpulse .7s infinite alternate; }
@keyframes brpulse { from { filter: brightness(1); } to { filter: brightness(1.45); } }
.br-banner { position: absolute; top: 20%; left: 50%; transform: translateX(-50%) scale(.92); font-weight: 700; font-size: 44px; text-align: center; text-transform: uppercase; letter-spacing: .05em;
  color: var(--cream); -webkit-text-stroke: 6px var(--ink); paint-order: stroke fill; text-shadow: 0 6px 0 rgba(0,0,0,.4); opacity: 0; transition: opacity .3s, transform .3s; white-space: nowrap; }
.br-banner.on { opacity: 1; transform: translateX(-50%) scale(1); }
.br-banner small { display: block; margin-top: 10px; font-size: 21px; font-weight: 500; text-transform: none; letter-spacing: 0; -webkit-text-stroke: 4px var(--ink); color: var(--amber); }

.br-mapbox { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.br-mapbox canvas { width: 184px; height: 184px; border-radius: 50%; background: #123; image-rendering: pixelated; border: 6px solid #4a311c;
  box-shadow: 0 0 0 3px var(--ink), inset 0 0 0 3px #8a6338, 0 6px 0 rgba(0,0,0,.4); }
.br-hunted { font-size: 19px; text-align: right; }
.br-hunted .t { font-weight: 700; letter-spacing: .12em; color: var(--amber); font-size: 15px; text-shadow: 0 2px 0 var(--ink); }
.br-hunted div.r { padding: 1px 12px; margin-top: 3px; background: rgba(18,12,7,.78); border-radius: 999px; border: 2px solid #6e4c2d; }

.br-feed { position: absolute; top: 102px; left: 14px; width: 340px; display: flex; flex-direction: column; gap: 4px; font-size: 19px; text-shadow: 0 2px 0 var(--ink); }
.br-feed div { background: rgba(18,12,7,.74); padding: 2px 12px; border-radius: 999px; border: 2px solid #6e4c2d; transition: opacity .6s; }
.br-feed div::before { content: '🐾 '; }
.br-feed div.old { opacity: 0; }
.br-feed div.me { border-color: var(--amber); }

.br-bottom { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(600px, 96vw); }
.br-row { display: flex; gap: 10px; align-items: flex-end; justify-content: center; }
.br-slot { position: relative; width: 66px; height: 66px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 14px; }
.br-slot .ic { font-size: 30px; line-height: 1; margin-top: -8px; filter: drop-shadow(0 2px 0 rgba(0,0,0,.5)); }
.br-slot .n { position: absolute; left: 0; right: 0; bottom: 3px; font-size: 12px; font-weight: 600; text-align: center; line-height: 1; padding: 0 2px; color: var(--cream); text-shadow: 0 1px 0 var(--ink); }
.br-slot .k { position: absolute; top: 3px; left: 3px; min-width: 20px; height: 20px; padding: 0 3px; border-radius: 999px; background: var(--leaf); color: #17210c; font-size: 13px; font-weight: 700; line-height: 20px; text-align: center; border: 2px solid var(--ink); z-index: 2; }
.br-slot .cd { position: absolute; inset: 0; border-radius: 12px; background: conic-gradient(rgba(10,6,3,.72) var(--p, 0%), transparent 0); }
.br-slot .cdt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; text-shadow: 0 2px 0 var(--ink); z-index: 2; }
.br-slot.ready { box-shadow: inset 0 0 0 2px var(--leaf), inset 0 3px 0 rgba(255,255,255,.14), 0 5px 0 rgba(0,0,0,.45); }
.br-slot.locked { opacity: .5; filter: grayscale(.7); }
.br-slot.sm { width: 54px; height: 54px; border-radius: 12px; }
.br-slot.sm .ic { font-size: 24px; margin-top: -6px; }
.br-slot.sm .n { font-size: 11px; }
.br-slot .q { position: absolute; top: 3px; right: 5px; font-size: 15px; font-weight: 700; color: var(--amber); text-shadow: 0 1px 0 var(--ink); z-index: 2; }
.br-slot.dash { width: 78px; }
.br-slot.dash .k { background: var(--amber); font-size: 10px; padding: 0 5px; height: 17px; line-height: 15px; }
.br-bar { position: relative; height: 26px; width: 100%; border: 3px solid var(--ink); border-radius: 999px; background: #1a110a; overflow: hidden; box-shadow: inset 0 3px 0 rgba(0,0,0,.4), 0 3px 0 rgba(0,0,0,.35); }
.br-bar > i { display: block; height: 100%; border-radius: 999px; transition: width .12s linear; box-shadow: inset 0 4px 0 rgba(255,255,255,.28), inset 0 -4px 0 rgba(0,0,0,.18); }
.br-bar span { position: absolute; inset: 0; text-align: center; font-size: 17px; font-weight: 700; line-height: 20px; text-shadow: 0 2px 0 var(--ink); }
.br-bar.hp > i { background: linear-gradient(#ff7a62, #d2432c); }
.br-bar.sta > i { background: linear-gradient(#ffd96a, #e0a020); }
.br-bar.xp > i { background: linear-gradient(#78d6e8, #2c8fb8); }
.br-bar.sm { height: 18px; } .br-bar.sm span { font-size: 13px; line-height: 12px; }
.br-lvl { min-width: 74px; text-align: center; font-weight: 700; font-size: 20px; padding: 3px 10px; border-radius: 14px; }
.br-lvl.br-point { animation: brpulse .6s infinite alternate; background: linear-gradient(#b7e46f, #6faa3a); color: #17210c; }
.br-buffs { display: flex; gap: 6px; min-height: 26px; font-size: 16px; flex-wrap: wrap; justify-content: center; }
.br-buffs span { background: rgba(18,12,7,.82); border: 2px solid var(--amber); border-radius: 999px; padding: 0 10px; text-transform: capitalize; }
.br-hint { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); font-size: 24px; font-weight: 600; padding: 4px 18px; border-radius: 999px; background: rgba(18,12,7,.85); border: 3px solid var(--leaf); text-shadow: 0 2px 0 var(--ink); }
.br-chan { position: absolute; left: 50%; top: 68%; transform: translateX(-50%); width: 240px; height: 18px; background: #1a110a; border: 3px solid var(--ink); border-radius: 999px; padding: 2px; }
.br-chan i { display: block; height: 100%; background: linear-gradient(#b7e46f, #6faa3a); border-radius: 999px; }
.br-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 40%, rgba(217,80,58,.6) 100%); opacity: 0; transition: opacity .25s; }
.br-lavavig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(255,120,0,.12) 20%, rgba(255,60,0,.62) 100%); opacity: 0; transition: opacity .2s; }
.br-blind { position: absolute; inset: 0; background: #fff; opacity: 0; transition: opacity .3s; }
.br-cursor { position: absolute; left: 50%; bottom: 190px; transform: translateX(-50%); font-size: 18px; padding: 2px 14px; border-radius: 999px; background: rgba(18,12,7,.85); border: 2px solid var(--river); }

.br-panel { position: absolute; left: 14px; top: 14px; bottom: 14px; width: 380px; padding: 14px 16px; pointer-events: auto; overflow-y: auto; }
.br-panel h3 { margin: 4px 0 8px; font-size: 20px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--amber); text-shadow: 0 2px 0 var(--ink); }
.br-panel .pts { font-size: 20px; margin-bottom: 4px; }
.br-panel .pts b { color: var(--leaf); font-size: 26px; }
.br-stat { display: flex; align-items: center; gap: 10px; margin: 4px 0; font-size: 21px; }
.br-stat .nm { flex: 1; }
.br-stat .key { min-width: 26px; height: 26px; border-radius: 999px; background: var(--leaf); color: #17210c; font-weight: 700; font-size: 15px; line-height: 22px; text-align: center; border: 2px solid var(--ink); }
.br-stat .val { font-weight: 700; min-width: 30px; text-align: right; }
.br-stat .br-btn { padding: 0; width: 34px; height: 30px; font-size: 20px; line-height: 22px; }
.br-pick { margin: 8px 0; padding: 8px; background: rgba(0,0,0,.3); border-radius: 12px; border: 2px solid #5a3d24; }
.br-pick .opts { display: flex; gap: 8px; }
.br-pick .opt { flex: 1; padding: 6px 8px; background: linear-gradient(#f7edd3, #e1d0a2); color: #2a1b0c; border: 3px solid var(--ink); border-radius: 12px; font-size: 16px; line-height: 1.1; cursor: pointer; text-align: left; }
.br-pick .opt:hover { filter: brightness(1.06); }
.br-pick .opt.chosen { background: linear-gradient(#b7e46f, #7fb844); }
.br-pick .opt.off { opacity: .45; cursor: default; filter: grayscale(.5); }
.br-pick .opt b { display: block; font-size: 18px; color: #6a3410; }
.br-pick .opt.chosen b { color: #1d3009; }
.br-pick .t { font-size: 17px; color: #e8d7ad; margin-bottom: 4px; }
.br-gulag { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 13vh; background: linear-gradient(rgba(14,8,6,.62), rgba(14,8,6,0) 60%); pointer-events: none; }
.br-gulag h2 { font-size: 54px; margin: 0; color: #ff7a5e; letter-spacing: .12em; -webkit-text-stroke: 6px var(--ink); paint-order: stroke fill; text-shadow: 0 6px 0 rgba(0,0,0,.4); }
.br-gulag p { font-size: 26px; margin: 8px 0; text-shadow: 0 2px 0 var(--ink); text-align: center; max-width: 600px; }
.br-choice { display: flex; gap: 12px; margin-top: 10px; pointer-events: auto; }
.br-leader { position: absolute; bottom: 160px; left: 50%; transform: translateX(-50%); width: min(540px, 92vw); padding: 10px 14px; text-align: center; font-size: 21px; line-height: 1.25; }
.br-leader b { color: var(--amber); font-weight: 700; }
.br-end { position: absolute; inset: 0; background: rgba(12,8,5,.84); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.br-end .box { width: min(740px, 94vw); max-height: 90vh; overflow: auto; padding: 22px 26px; }
.br-end h2 { font-size: 40px; margin: 0 0 4px; color: var(--amber); letter-spacing: .06em; text-shadow: 0 4px 0 var(--ink); }
.br-end table { width: 100%; border-collapse: collapse; font-size: 20px; margin: 12px 0 16px; }
.br-end td, .br-end th { padding: 3px 10px; text-align: left; border-bottom: 2px solid rgba(255,255,255,.12); }
.br-end th { color: var(--amber); font-size: 15px; letter-spacing: .1em; text-transform: uppercase; }
.br-end tr.me td { color: var(--amber); background: rgba(243,180,60,.14); }
.br-pause { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(12,8,5,.55); pointer-events: auto; }
.br-pause .box { padding: 24px 30px; display: flex; flex-direction: column; gap: 12px; min-width: 320px; align-items: stretch; }
.br-pause h2 { font-size: 30px; margin: 0 0 4px; text-align: center; color: var(--amber); letter-spacing: .08em; text-transform: uppercase; }
.br-pause small { font-size: 17px; color: #e8d7ad; text-align: center; }
.br-help { position: absolute; right: 14px; bottom: 14px; max-width: 330px; text-align: right; font-size: 16px; line-height: 1.15; color: #f1e4c0; text-shadow: 0 2px 0 var(--ink); opacity: .9; }

.br-reticle { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.br-reticle .dot { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%; background: var(--cream); border: 2px solid var(--ink); }
.br-reticle .ring { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; border: 3px solid rgba(247,237,211,.0); transition: border-color .08s, transform .08s; }
.br-reticle.guard .ring { border-color: rgba(143,216,255,.85); transform: scale(1); }
.br-reticle.parry .ring { border-color: #ffe27a; box-shadow: 0 0 16px #ffe27a, inset 0 0 12px rgba(255,226,122,.6); transform: scale(1.12); }
.br-reticle.counter .dot { background: #ffe27a; box-shadow: 0 0 12px #ffe27a; }
.br-reticle.wind .dot { background: var(--blood); }
.br-pips { position: absolute; left: -27px; top: 30px; display: flex; gap: 6px; }
.br-pips i { width: 14px; height: 14px; border-radius: 50%; background: rgba(18,12,7,.7); border: 2px solid var(--cream); transition: background .08s, transform .08s; }
.br-pips i.on { background: var(--amber); transform: scale(1.15); }
.br-pips i.heavy { border-radius: 4px; border-color: var(--blood); }
.br-pips i.heavy.on { background: var(--blood); }
.br-guardtag { position: absolute; left: -40px; top: 52px; width: 80px; text-align: center; font-weight: 700; font-size: 14px; letter-spacing: .14em; color: #bfe8ff; text-shadow: 0 2px 0 var(--ink); }
.br-callout { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) scale(.6); font-size: 58px; font-weight: 700; letter-spacing: .06em; opacity: 0; -webkit-text-stroke: 7px var(--ink); paint-order: stroke fill; text-shadow: 0 6px 0 rgba(0,0,0,.4); pointer-events: none; white-space: nowrap; }
.br-callout.pop { animation: brcallout .75s ease-out forwards; }
@keyframes brcallout { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.25); } 30% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -80%) scale(1); } }
.br-lowhp { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 35%, rgba(190,20,10,.55) 100%); opacity: 0; pointer-events: none; }
.br-lowhp.on { animation: brheart 0.9s ease-in-out infinite; }
@keyframes brheart { 0%, 100% { opacity: .25; } 18% { opacity: .85; } 34% { opacity: .35; } 50% { opacity: .7; } }
.br-bar.sta.empty > i { background: linear-gradient(#ff8a6a, #d2432c); }

.br-streak { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); text-align: center; pointer-events: none; opacity: 0; }
.br-streak.pop { animation: brstreak 2.4s ease-out forwards; }
.br-streak b { display: block; font-size: 64px; font-weight: 700; letter-spacing: .08em; color: #ffb23a; -webkit-text-stroke: 8px var(--ink); paint-order: stroke fill; text-shadow: 0 7px 0 rgba(0,0,0,.45), 0 0 30px rgba(255,120,20,.7); }
.br-streak span { display: block; margin-top: 4px; font-size: 26px; font-weight: 600; color: var(--cream); text-shadow: 0 3px 0 var(--ink); letter-spacing: .2em; }
.br-streak.hot b { color: #ff5a3a; font-size: 78px; }
@keyframes brstreak { 0% { opacity: 0; transform: translateX(-50%) scale(.4) rotate(-4deg); } 10% { opacity: 1; transform: translateX(-50%) scale(1.3) rotate(2deg); } 22% { transform: translateX(-50%) scale(1) rotate(0); } 78% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(1); } }

/* --- polish --- */
.br-bar.hp { overflow: hidden; }
.br-bar.hp > i { position: relative; z-index: 1; }
.br-bar.hp > u { position: absolute; left: 0; top: 0; height: 100%; background: linear-gradient(#fff4d0, #e9c98a); opacity: .85; z-index: 0; border-radius: 999px; transition: width .08s; }
.br-bar span { z-index: 2; }
.br-bar.xp.gain > i { animation: brgain .5s ease-out; }
@keyframes brgain { 0% { filter: brightness(2.2); box-shadow: 0 0 14px #78d6e8; } 100% { filter: none; } }
.br-slot.flash { animation: brready .45s ease-out; }
@keyframes brready { 0% { filter: brightness(2.4); transform: scale(1.14); } 100% { filter: none; transform: scale(1); } }
.br-slot.pop { animation: brpop .4s ease-out; }
@keyframes brpop { 0% { transform: scale(1.3) rotate(-6deg); filter: brightness(1.8); } 60% { transform: scale(.95); } 100% { transform: none; filter: none; } }
.br-slot.press { transform: translateY(3px) scale(.96); }
.br-lvl.up { animation: brlvl 1s ease-out; }
@keyframes brlvl { 0% { transform: scale(1.7); filter: brightness(2.5); } 40% { transform: scale(.92); } 100% { transform: none; filter: none; } }
.br-levelring { position: absolute; left: 50%; top: 58%; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; border: 6px solid #ffe27a; opacity: 0; pointer-events: none; }
.br-levelring.go { animation: brring .9s ease-out; }
@keyframes brring { 0% { opacity: 1; transform: scale(.4); } 100% { opacity: 0; transform: scale(14); } }
.br-reticle.hit .dot { background: #fff; transform: scale(2.2); box-shadow: 0 0 10px #fff; }
.br-reticle .x { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; opacity: 0; pointer-events: none; }
.br-reticle .x::before, .br-reticle .x::after { content: ''; position: absolute; left: 12px; top: -2px; width: 4px; height: 32px; background: #fff; border: 1px solid var(--ink); border-radius: 2px; }
.br-reticle .x::before { transform: rotate(45deg); } .br-reticle .x::after { transform: rotate(-45deg); }
.br-reticle .x.go { animation: brhit .22s ease-out; }
.br-reticle .x.big::before, .br-reticle .x.big::after { background: #ff6b5a; }
@keyframes brhit { 0% { opacity: 1; transform: scale(.6); } 100% { opacity: 0; transform: scale(1.5); } }
.br-top { animation: brdrop .6s ease-out both; }
.br-bottom { animation: brrise .6s ease-out both; }
@keyframes brdrop { from { opacity: 0; transform: translate(-50%, -30px); } }
@keyframes brrise { from { opacity: 0; transform: translate(-50%, 40px); } }
.br-feed div { animation: brslide .3s ease-out; }
@keyframes brslide { from { opacity: 0; transform: translateX(-24px); } }
.br-phase b { text-shadow: 0 0 12px rgba(243,180,60,.5); }

.br-feed { top: 212px !important; }
.br-doll { position: absolute; left: 14px; top: 14px; width: 168px; height: 198px; border: 5px solid #4a311c; border-radius: 16px; box-shadow: 0 0 0 3px var(--ink), inset 0 0 0 3px #8a6338, inset 0 0 40px rgba(0,0,0,.35), 0 6px 0 rgba(0,0,0,.4); background: radial-gradient(circle at 50% 35%, rgba(120,170,90,.35), rgba(20,30,15,.55)); }
.br-doll .tag { position: absolute; left: 10px; right: 10px; bottom: -22px; text-align: center; font-weight: 700; font-size: 17px; letter-spacing: .06em; text-shadow: 0 2px 0 var(--ink); }
.br-info { position: absolute; left: 14px; bottom: 14px; width: 286px; padding: 10px 12px; font-size: 16px; line-height: 1.12; }
.br-info .hd { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.br-info .em { font-size: 40px; filter: drop-shadow(0 3px 0 rgba(0,0,0,.4)); }
.br-info .hd b { display: block; font-size: 24px; color: var(--amber); letter-spacing: .03em; text-shadow: 0 2px 0 var(--ink); }
.br-info .hd small { font-size: 15px; color: #e8d7ad; }
.br-info .st { display: grid; grid-template-columns: 64px 1fr 30px; gap: 1px 6px; align-items: center; margin: 4px 0 6px; font-size: 14px; font-weight: 600; }
.br-info .st i { display: block; height: 7px; border-radius: 999px; background: linear-gradient(#f0a640, #c3680f); border: 1px solid var(--ink); }
.br-info .st em { font-style: normal; text-align: right; color: var(--cream); }
.br-info .pk { border-top: 2px dashed rgba(255,255,255,.18); padding-top: 5px; font-size: 14px; }
.br-info .pk .p { color: #a8e26a; } .br-info .pk .d { color: #ff9a82; }
`;

const el = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
  const e = document.createElement(tag) as T;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const FX_ICON: Record<string, string> = { cone: '🦷', dash: '💨', aoe: '💥', proj: '🪨', buff: '✨', heal: '💚', grab: '✊', submerge: '🌊' };
const SKILL_ICON: Record<string, string> = {
  howl: '🌙', alpha_howl: '🌕', roar: '📢', frenzy: '🔥', thick_hide: '🛡️', quill_coat: '🛡️', burst: '⚡', swerve: '↩️', musk_spray: '☁️', rock_throw: '🪨',
  quill_shot: '🪶', quill_burst: '🌵', quill_storm: '🌵', earthshaker: '🌋', splash: '💦', tail_whip: '🌀', death_roll: '🐊', submerge: '🌊', rampage: '😡',
};
const skillIcon = (s: { id: string; fx?: { k: string } } | null) => (s ? (SKILL_ICON[s.id] ?? (s.fx ? (FX_ICON[s.fx.k] ?? '✨') : '⭐')) : '🔒');
const EMOJI: Record<string, string> = { wolf: '🐺', bear: '🐻', cheetah: '🐆', badger: '🦡', croc: '🐊', boar: '🐗', otter: '🦦', porcupine: '🦔', lion: '🦁', hippo: '🦛', redfox: '🦊', leopard: '🐈', gorilla: '🦍', turtle: '🐢', kangaroo: '🦘', skunk: '🦨' };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ITEM_NAMES: Record<string, string> = {
  meat: 'Meat', berry: 'Berries', herb: 'Herb', water: 'Water', mud: 'Mud', honey: 'Honeycomb', feather: 'Feather', tusk: 'Tusk', musk: 'Musk', reed: 'Reed',
};
const ITEM_HINTS: Record<string, string> = {
  meat: 'Heals over time. Spoils.', berry: 'Small heal and stamina.', herb: 'Cures bleed, short speed boost.', water: 'Restores stamina. Refill at water.',
  mud: 'Less lava damage for a while.', honey: 'Throw to lure hordes.', feather: 'Glide over lava briefly.', tusk: 'Your next hits cause bleed.', musk: 'Hide your trail, pause the hunted mark.', reed: 'Hide underwater.',
};
const ITEM_ICON: Record<string, string> = { meat: '🍖', berry: '🍒', herb: '🌿', water: '💧', mud: '🟤', honey: '🍯', feather: '🪶', tusk: '🦷', musk: '🧪', reed: '🌾' };
export const itemLabel = (k: string) => ITEM_NAMES[k] ?? k;

export interface HudCtx {
  you: YouState;
  g: Global;
  def: AnimalDef;
  roster: Map<string, RosterEntry>;
  myId: string;
  now: number; // client clock
  hint: string;
  panelOpen: boolean;
}

export class Hud {
  readonly root = el('div');
  private top = el('div', 'br-top');
  private phase = el('div', 'br-phase wood');
  private ring = el('div', 'br-ring');
  private banner = el('div', 'br-banner');
  private mapCanvas = el<HTMLCanvasElement>('canvas');
  private hunted = el('div', 'br-hunted');
  private feed = el('div', 'br-feed');
  private hp = el('div', 'br-bar hp');
  private sta = el('div', 'br-bar sta sm');
  private xp = el('div', 'br-bar xp sm');
  private lvl = el('div', 'br-lvl wood');
  private buffs = el('div', 'br-buffs');
  private skillRow = el('div', 'br-row');
  private invRow = el('div', 'br-row');
  private hint = el('div', 'br-hint');
  private chan = el('div', 'br-chan');
  private vig = el('div', 'br-vig');
  private lavaVig = el('div', 'br-lavavig');
  private blind = el('div', 'br-blind');
  private panel = el('div', 'br-panel wood');
  private gulag = el('div', 'br-gulag');
  private leader = el('div', 'br-leader wood');
  private reticle = el('div', 'br-reticle', '<div class="ring"></div><div class="x"></div><div class="dot"></div><div class="br-pips"><i></i><i></i><i class="heavy"></i></div><div class="br-guardtag"></div>');
  private callouts = el('div', 'br-callout');
  private streakEl = el('div', 'br-streak', '<b></b><span></span>');
  private lowhp = el('div', 'br-lowhp');
  private cursor = el('div', 'br-cursor', 'Cursor free — click things, then press Left Alt to go back');
  private dashEl = { root: el('div', 'br-slot dash wood'), cd: el('div', 'cd'), cdt: el('div', 'cdt') };
  private help = el('div', 'br-help');
  private end = el('div', 'br-end');
  private pause = el('div', 'br-pause');
  private skillEls: { root: HTMLElement; name: HTMLElement; cd: HTMLElement; cdt: HTMLElement; k: HTMLElement; ic: HTMLElement }[] = [];
  private invEls: { root: HTMLElement; n: HTMLElement; q: HTMLElement; ic: HTMLElement }[] = [];
  private mapBase: HTMLCanvasElement | null = null;
  private bannerTimer = 0;
  private bannerQueue: { title: string; sub?: string; ms: number }[] = [];
  private bannerBusy = false;
  private vigTimer = 0;
  private lastPanelKey = '';
  private ghostHp = 100;
  private ghostAt = 0;
  private lastHpPct = 100;
  private prevCd = [0, 0, 0, 0];
  private prevInv: string[] = [];
  private prevXp = 0;
  private levelRing = el('div', 'br-levelring');
  private dollFrame = el('div', 'br-doll', '<div class="tag"></div>');
  private info = el('div', 'br-info wood');
  private infoKey = '';
  private lastGulagKey = '';
  private lastLeaderKey = '';
  onStat: (k: StatKey) => void = () => {};
  onPick: (tier: number, opt: number) => void = () => {};
  onSwarm: (k: string) => void = () => {};
  onResume: () => void = () => {};
  onSettings: () => void = () => {};
  onLeave: () => void = () => {};
  onBack: () => void = () => {};

  constructor() {
    if (!document.getElementById('br-css')) {
      const st = document.createElement('style');
      st.id = 'br-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.root.id = 'br-root';
    this.root.hidden = true;
    this.phase.innerHTML = '<span id="br-ph"></span><b id="br-clock"></b><span id="br-alive"></span>';
    this.top.append(this.phase, this.ring);
    this.mapCanvas.width = 180;
    this.mapCanvas.height = 180;
    const mapbox = el('div', 'br-mapbox');
    mapbox.append(this.mapCanvas, this.hunted);

    const bottom = el('div', 'br-bottom');
    // the dash every animal has, then the four skills
    {
      const d = this.dashEl;
      d.root.append(el('div', 'ic', '💨'), el('span', 'k', 'SHIFT'), el('div', 'n', 'Dash'), d.cd, d.cdt);
      this.skillRow.append(d.root);
    }
    ['Q', 'E', 'R', 'F'].forEach((k) => {
      const s = el('div', 'br-slot wood');
      const kk = el('span', 'k', k);
      const ic = el('div', 'ic');
      const name = el('div', 'n');
      const cd = el('div', 'cd');
      const cdt = el('div', 'cdt');
      s.append(ic, kk, name, cd, cdt);
      this.skillRow.append(s);
      this.skillEls.push({ root: s, name, cd, cdt, k: kk, ic });
    });
    for (let i = 0; i < 6; i++) {
      const s = el('div', 'br-slot sm wood');
      s.append(el('span', 'k', String(i + 1)));
      const ic = el('div', 'ic');
      const n = el('div', 'n');
      const q = el('span', 'q');
      s.append(ic, n, q);
      this.invRow.append(s);
      this.invEls.push({ root: s, n, q, ic });
    }
    const bars = el('div', '');
    bars.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:3px';
    const hpRow = el('div', '');
    hpRow.style.cssText = 'display:flex;gap:8px;align-items:center';
    this.hp.innerHTML = '<i></i><u></u><span></span>';
    this.sta.innerHTML = '<i></i><span></span>';
    this.xp.innerHTML = '<i></i><span></span>';
    this.hp.style.flex = '1';
    hpRow.append(this.lvl, this.hp);
    bars.append(hpRow, this.sta, this.xp);
    const rows = el('div', 'br-row');
    rows.style.alignItems = 'flex-end';
    rows.append(this.skillRow, el('div', '', '&nbsp;'), this.invRow);
    bottom.append(this.buffs, rows, bars);

    this.help.innerHTML = 'WASD move · Space jump · tap Shift dash (hold = sprint) · C sneak<br>LMB attack (3-hit combo) · hold RMB guard — raise it just before a hit to PARRY<br>Q E R F skills · X harvest · V drink · 1-6 eat/use · Tab upgrades · Left Alt cursor';
    this.gulag.hidden = true;
    this.leader.hidden = true;
    this.panel.hidden = true;
    this.end.hidden = true;
    this.pause.hidden = true;
    this.hint.hidden = true;
    this.chan.hidden = true;
    this.chan.innerHTML = '<i></i>';
    this.cursor.hidden = true;
    this.root.append(this.vig, this.lavaVig, this.lowhp, this.blind, this.reticle, this.callouts, this.streakEl, this.levelRing, this.dollFrame, this.info, this.top, this.banner, mapbox, this.feed, this.hint, this.chan, this.cursor, this.panel, this.gulag, this.leader, bottom, this.help, this.end, this.pause);
    document.body.append(this.root);
    this.buildPause();
  }

  show(on: boolean) {
    this.root.hidden = !on;
  }

  // --- minimap -----------------------------------------------------------------------------------

  setTerrain(t: Terrain) {
    const S = 180;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px / S - 0.5) * MAP_RADIUS * 2;
        const z = (py / S - 0.5) * MAP_RADIUS * 2;
        const h = t.heightAt(x, z);
        const b = t.biomeAt(x, z);
        let col: number[];
        if (h < -1.2) col = [38, 92, 130];
        else if (h < 0) col = [70, 140, 170];
        else if (b === Biome.Forest) col = [52, 100, 52];
        else if (b === Biome.Wetlands) col = [90, 130, 70];
        else if (b === Biome.Grassland) col = [150, 170, 80];
        else col = h > 20 ? [225, 228, 230] : [138, 134, 118];
        const shade = 1 + Math.max(-0.2, Math.min(0.2, (h - t.heightAt(x - 6, z - 6)) * 0.06));
        const i = (py * S + px) * 4;
        img.data[i] = Math.min(255, col[0] * shade);
        img.data[i + 1] = Math.min(255, col[1] * shade);
        img.data[i + 2] = Math.min(255, col[2] * shade);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c;
  }

  drawMap(me: { x: number; z: number; yaw: number }, g: Global, blips: { x: number; z: number; kind: 'foe' | 'friend' | 'mob' | 'alpha' | 'ping' | 'big'; r?: number }[]) {
    const c = this.mapCanvas.getContext('2d')!;
    const S = 180;
    const k = S / (MAP_RADIUS * 2);
    c.clearRect(0, 0, S, S);
    if (this.mapBase) c.drawImage(this.mapBase, 0, 0);
    // lava outside the ring
    c.save();
    c.beginPath();
    c.rect(0, 0, S, S);
    c.arc(S / 2, S / 2, g.ring * k, 0, Math.PI * 2, true);
    c.fillStyle = 'rgba(255,70,10,.6)';
    c.fill('evenodd');
    c.restore();
    if (g.ringTo > 0 && g.ringTo < g.ring - 1) {
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.arc(S / 2, S / 2, g.ringTo * k, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    for (const b of blips) {
      const px = S / 2 + b.x * k;
      const py = S / 2 + b.z * k;
      switch (b.kind) {
        case 'mob':
          c.fillStyle = 'rgba(255,255,255,.55)';
          c.fillRect(px - 1, py - 1, 2, 2);
          break;
        case 'big':
          c.fillStyle = '#ffb347';
          c.fillRect(px - 2, py - 2, 4, 4);
          break;
        case 'foe':
          c.fillStyle = '#ff4b3a';
          c.beginPath();
          c.arc(px, py, 3, 0, Math.PI * 2);
          c.fill();
          break;
        case 'friend':
          c.fillStyle = '#58e03a';
          c.beginPath();
          c.arc(px, py, 3, 0, Math.PI * 2);
          c.fill();
          break;
        case 'alpha':
          c.fillStyle = '#ff2f2f';
          c.font = '12px sans-serif';
          c.fillText('☠', px - 6, py + 4);
          break;
        case 'ping': {
          const pulse = 6 + ((performance.now() / 120) % 8);
          c.strokeStyle = '#ffd23f';
          c.lineWidth = 2;
          c.beginPath();
          c.arc(px, py, pulse, 0, Math.PI * 2);
          c.stroke();
          break;
        }
      }
    }
    // me
    const px = S / 2 + me.x * k;
    const py = S / 2 + me.z * k;
    c.save();
    c.translate(px, py);
    c.rotate(-me.yaw + Math.PI);
    c.fillStyle = '#fff';
    c.strokeStyle = '#0b0b1a';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(0, 2);
    c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  // --- messages -----------------------------------------------------------------------------------

  announce(title: string, sub = '', ms = 3200) {
    this.bannerQueue.push({ title, sub, ms });
    if (!this.bannerBusy) this.nextBanner();
  }
  private nextBanner() {
    const b = this.bannerQueue.shift();
    if (!b) {
      this.bannerBusy = false;
      this.banner.classList.remove('on');
      return;
    }
    this.bannerBusy = true;
    this.banner.innerHTML = '';
    this.banner.append(document.createTextNode(b.title));
    if (b.sub) this.banner.append(el('small', '', b.sub));
    this.banner.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.remove('on');
      this.bannerTimer = window.setTimeout(() => this.nextBanner(), 350);
    }, b.ms);
  }

  feedLine(text: string, mine = false) {
    const d = el('div', mine ? 'me' : '');
    d.textContent = text;
    this.feed.append(d);
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
    setTimeout(() => d.classList.add('old'), 7000);
    setTimeout(() => d.remove(), 7800);
  }

  flashHurt() {
    this.vig.style.opacity = '1';
    clearTimeout(this.vigTimer);
    this.vigTimer = window.setTimeout(() => (this.vig.style.opacity = '0'), 160);
  }

  // --- the frame ----------------------------------------------------------------------------------

  private skillFor(def: AnimalDef, you: YouState, slot: number): { skill: Skill | null; locked: string } {
    if (slot < 2) return { skill: def.sig[slot], locked: '' };
    const tier = slot === 2 ? 0 : 2;
    const p = you.picks[tier];
    if (p >= 0) return { skill: def.unlock[tier][p], locked: '' };
    return { skill: null, locked: you.lvl >= UNLOCK_LEVELS[tier] ? 'Pick (Tab)' : `Lv ${UNLOCK_LEVELS[tier]}` };
  }

  render(c: HudCtx) {
    const { you, g, def } = c;
    const role = you.role; // 0 alive, 1 gulag, 2 leader, 3 out
    const t = g.time;
    (this.root.querySelector('#br-ph') as HTMLElement).textContent = ['Scatter', 'Farm', 'Clash', 'Cull', 'Final'][g.phase];
    (this.root.querySelector('#br-clock') as HTMLElement).textContent = fmt(t);
    (this.root.querySelector('#br-alive') as HTMLElement).textContent = `${g.alive} alive${g.leaders ? ` · ${g.leaders} leaders` : ''}`;
    // lava status
    if (g.ringAt > t) {
      const left = g.ringAt - t;
      const warn = left <= 30;
      this.ring.textContent = warn ? `LAVA CLOSES IN ${Math.ceil(left)}s (ring ${g.ringN})` : `Next lava ring in ${fmt(left)}`;
      this.ring.classList.toggle('warn', warn);
    } else if (g.ringTo > 0 && g.ringTo < g.ring - 1) {
      this.ring.textContent = 'The lava is closing in!';
      this.ring.classList.add('warn');
    } else {
      this.ring.textContent = g.ringN >= 5 ? 'Final stand: the lava is rising!' : 'The lava has settled — for now';
      this.ring.classList.remove('warn');
    }

    const body = role === 0 || role === 1 || role === 2;
    this.skillRow.parentElement!.parentElement!.style.display = role === 3 ? 'none' : '';
    // bars
    const hpPct = Math.max(0, Math.min(100, (you.hp / you.maxHp) * 100));
    (this.hp.firstElementChild as HTMLElement).style.width = `${hpPct}%`;
    (this.hp.lastElementChild as HTMLElement).textContent = `${Math.ceil(you.hp)} / ${you.maxHp}`;
    // the pale chip behind the health bar shows what you just lost, then drains away
    const nowMs = performance.now();
    if (hpPct < this.lastHpPct - 0.3) this.ghostAt = nowMs + 450;
    if (hpPct >= this.ghostHp) this.ghostHp = hpPct;
    else if (nowMs > this.ghostAt) this.ghostHp = Math.max(hpPct, this.ghostHp - 0.9);
    this.lastHpPct = hpPct;
    (this.hp.querySelector('u') as HTMLElement).style.width = `${this.ghostHp}%`;
    // the XP bar glows when it fills
    if (you.xp > this.prevXp && role === 0) {
      this.xp.classList.remove('gain');
      void this.xp.offsetWidth;
      this.xp.classList.add('gain');
    }
    this.prevXp = you.xp;
    (this.sta.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, (you.sta / you.maxSta) * 100))}%`;
    (this.sta.lastElementChild as HTMLElement).textContent = 'Stamina';
    (this.xp.firstElementChild as HTMLElement).style.width = role === 0 ? `${Math.min(100, (you.xp / you.need) * 100)}%` : '0%';
    (this.xp.lastElementChild as HTMLElement).textContent = role === 0 ? (you.lvl >= 20 ? 'MAX' : `${you.xp} / ${you.need} XP`) : '';
    this.xp.style.display = role === 0 ? '' : 'none';
    this.lvl.textContent = role === 2 ? `T${you.swarm?.tier ?? 1}` : role === 1 ? 'GULAG' : `LV ${you.lvl}`;
    this.lvl.classList.toggle('br-point', role === 0 && (you.pts > 0 || this.canPick(you)));

    // buffs
    const buffs = you.buffs.map((b) => `<span>${b.replace(/_/g, ' ')}</span>`).join('') + (you.ability ? `<span>${you.ability}</span>` : '');
    if (this.buffs.innerHTML !== buffs) this.buffs.innerHTML = buffs;

    // skill slots
    for (let i = 0; i < 4; i++) {
      const e = this.skillEls[i];
      let name = '';
      let ready = false;
      let locked = false;
      if (role === 2) {
        const sw = SWARMS.find((s) => s.id === you.swarm?.kind);
        name = i === 0 ? (sw?.skill.name ?? 'Skill') : i === 1 ? (you.swarm && you.swarm.tier >= 3 ? 'Frenzy' : 'Tier III') : '';
        locked = i > 1 || (i === 1 && !!you.swarm && you.swarm.tier < 3);
      } else {
        const s = this.skillFor(def, you, i);
        name = s.skill?.name ?? s.locked;
        locked = !s.skill;
      }
      const cd = you.cds[i];
      const max = Math.max(0.1, you.cdMax[i] || 1);
      ready = !locked && cd <= 0.05;
      e.name.textContent = name;
      e.ic.textContent = role === 2 ? (i === 0 ? '🐀' : i === 1 ? '🔥' : '🔒') : skillIcon(this.skillFor(def, you, i).skill);
      e.root.classList.toggle('locked', locked);
      e.root.classList.toggle('ready', ready);
      e.cd.style.setProperty('--p', locked ? '0%' : `${Math.min(100, (cd / max) * 100)}%`);
      e.cdt.textContent = !locked && cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '';
      if (!locked && this.prevCd[i] > 0.05 && cd <= 0.05) this.flash(e.root, 'flash');
      this.prevCd[i] = cd;
    }
    // dash
    const dd = you.dash ?? 0;
    this.dashEl.cd.style.setProperty('--p', `${Math.min(100, (dd / Math.max(0.1, you.dashMax || 2.4)) * 100)}%`);
    this.dashEl.cdt.textContent = dd > 0.05 ? dd.toFixed(1) : '';
    this.dashEl.root.classList.toggle('ready', dd <= 0.05 && you.sta >= 22);
    this.dashEl.root.classList.toggle('locked', role === 3);
    // inventory
    this.invRow.style.display = role === 0 ? '' : 'none';
    for (let i = 0; i < 6; i++) {
      const it: InvItem | null = you.inv[i];
      const e = this.invEls[i];
      if (!it) {
        this.prevInv[i] = '';
        e.n.textContent = '';
        e.ic.textContent = '';
        e.q.textContent = '';
        e.root.title = '';
        e.root.style.opacity = '.5';
        continue;
      }
      e.root.style.opacity = it.k === 'water' && it.n === 0 ? '.55' : '1';
      const key = `${it.k}${it.n}`;
      if (this.prevInv[i] !== undefined && this.prevInv[i] !== key && !(this.prevInv[i] || '').startsWith(it.k + 'x')) this.flash(e.root, 'pop');
      this.prevInv[i] = key;
      e.ic.textContent = ITEM_ICON[it.k] ?? '';
      e.n.textContent = ITEM_NAMES[it.k];
      e.q.textContent = it.k === 'water' ? `${it.n}/2` : it.n > 1 ? String(it.n) : '';
      e.root.title = ITEM_HINTS[it.k] ?? '';
    }
    // hint + channel
    const hint = body && role === 0 ? c.hint : '';
    this.hint.hidden = !hint;
    if (hint && this.hint.textContent !== hint) this.hint.textContent = hint;
    this.chan.hidden = !you.channel;
    if (you.channel) (this.chan.firstElementChild as HTMLElement).style.width = `${100 - (you.channel.left / you.channel.total) * 100}%`;

    // hunted list
    const hl = g.top
      .map(([id, lvl], i) => `<div class="r">${i === 0 ? '🎯 ' : ''}${c.roster.get(id)?.name ?? '?'} · Lv ${lvl}${id === c.myId ? ' (you)' : ''}</div>`)
      .join('');
    const hh = hl ? `<div class="t">HUNTED</div>${hl}` : '';
    if (this.hunted.innerHTML !== hh) this.hunted.innerHTML = hh;

    this.renderInfo(you, def, role);
    this.renderPanel(c);
    this.renderGulag(c);
    this.renderLeader(c);
    this.blind.style.opacity = you.buffs.includes('blind') ? '0.8' : '0';
  }

  private canPick(you: YouState) {
    return UNLOCK_LEVELS.some((l, i) => you.lvl >= l && you.picks[i] === -1);
  }

  private renderPanel(c: HudCtx) {
    const { you, def } = c;
    const open = c.panelOpen && you.role === 0;
    this.panel.hidden = !open;
    if (!open) return;
    const key = JSON.stringify([you.lvl, you.pts, you.alloc, you.picks, def.id]);
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    this.panel.innerHTML = '';
    this.panel.append(el('h3', '', `${def.name} · Level ${you.lvl}`));
    this.panel.append(el('div', 'pts', `<b>${you.pts}</b> stat point${you.pts === 1 ? '' : 's'} to spend`));
    STAT_KEYS.forEach((k, i) => {
      const row = el('div', 'br-stat');
      row.append(el('span', 'key', String(i + 1)), el('span', 'nm', STAT_NAMES[k]), el('span', 'val', String(def.stats[k] + you.alloc[k])));
      const b = el<HTMLButtonElement>('button', 'br-btn', '+');
      b.disabled = you.pts <= 0;
      b.addEventListener('click', () => this.onStat(k));
      row.append(b);
      this.panel.append(row);
    });
    const tiers = [0, 1, 2, 3];
    this.panel.append(el('h3', '', 'Skills'));
    const inn = def.innate;
    this.panel.append(el('div', 'br-pick', `<div class="t"><b style="color:var(--amber)">${inn.name}</b> (innate): ${inn.desc}</div>`));
    for (const t of tiers) {
      const box = el('div', 'br-pick');
      const need = UNLOCK_LEVELS[t];
      const chosen = you.picks[t];
      box.append(el('div', 't', `Level ${need} · ${t % 2 === 0 ? 'active' : 'passive'}${you.lvl < need ? ' (locked)' : chosen < 0 ? ` — press Z or X` : ''}`));
      const opts = el('div', 'opts');
      def.unlock[t].forEach((s, o) => {
        const d = el('div', `opt${chosen === o ? ' chosen' : ''}${you.lvl < need || (chosen >= 0 && chosen !== o) ? ' off' : ''}`, `<b>${s.name}</b>${s.desc}`);
        d.addEventListener('click', () => this.onPick(t, o));
        opts.append(d);
      });
      box.append(opts);
      this.panel.append(box);
    }
    this.panel.append(el('div', 'br-pick', '<div class="t">Keys: 1-5 spend a point · Z / X pick the first open skill · Tab closes</div>'));
  }

  private renderGulag(c: HudCtx) {
    const y = c.you;
    const on = y.role === 1 && !!y.gulag;
    this.gulag.hidden = !on;
    if (!on || !y.gulag) return;
    const gu = y.gulag;
    const key = `${gu.phase}|${gu.foe}|${Math.ceil(gu.left)}|${gu.choose.join()}`;
    if (key === this.lastGulagKey) return;
    this.lastGulagKey = key;
    const picked = c.roster.get(c.myId)?.swarm;
    this.gulag.innerHTML = '';
    this.gulag.append(el('h2', '', 'THE GULAG'));
    this.gulag.append(
      el(
        'p',
        '',
        gu.phase === 'duel'
          ? `Duel vs <b style="color:var(--amber)">${gu.foe}</b> · ${Math.ceil(gu.left)}s<br>Equal stats. Win to lead a bigger swarm.`
          : 'Waiting for an opponent. If nobody comes, you fight the Warden.<br>Gulag voice chat is separate from the match.',
      ),
    );
    const row = el('div', 'br-choice');
    for (const k of gu.choose) {
      const sw = SWARMS.find((s) => s.id === k)!;
      const b = el<HTMLButtonElement>('button', `br-btn ${picked === k ? '' : 'wood'}`, `${sw.name} — ${sw.skill.name}`);
      b.addEventListener('click', () => this.onSwarm(k));
      row.append(b);
    }
    this.gulag.append(el('p', '', 'Choose your swarm:'), row);
  }

  private renderLeader(c: HudCtx) {
    const y = c.you;
    const on = y.role === 2 && !!y.swarm;
    this.leader.hidden = !on;
    if (!on || !y.swarm) return;
    const s = y.swarm;
    const sw = SWARMS.find((x) => x.id === s.kind)!;
    const key = JSON.stringify(s);
    if (key === this.lastLeaderKey) return;
    this.lastLeaderKey = key;
    const prog = s.next ? `${s.eaten}/${s.next} eaten to grow` : 'Max tier';
    this.leader.innerHTML =
      `<b>${sw.name}</b> · Tier ${s.tier} · swarm ${s.units}/${s.want} · order: <b>${s.order}</b><br>` +
      (s.respawn > 0 ? `Your leader fell. Back in <b>${Math.ceil(s.respawn)}s</b>` : `1 attack · 2 scatter · 3 guard · Q ${sw.skill.name} · G eat food · ${prog}`);
  }

  // --- end / pause -----------------------------------------------------------------------------------

  showEnd(res: { winner: string; team: number; results: { id: string; name: string; animal: string; lvl: number; kills: number; place: number; dmg: number }[] }, myId: string, myTeam: number) {
    this.end.hidden = false;
    this.end.innerHTML = '';
    const box = el('div', 'box wood');
    const won = res.team === myTeam;
    box.append(el('h2', '', won ? 'VICTORY!' : 'Match over'));
    box.append(el('div', '', `Last one standing: <b style="color:var(--amber)">${res.winner}</b>`));
    const rows = res.results
      .slice(0, 20)
      .map((r) => `<tr class="${r.id === myId ? 'me' : ''}"><td>${r.place}</td><td>${r.name}</td><td>${ANIMAL_BY_ID.get(r.animal)?.name ?? r.animal}</td><td>Lv ${r.lvl}</td><td>${r.kills}</td><td>${r.dmg}</td></tr>`)
      .join('');
    box.append(el('table', '', `<tr><th>#</th><th>Player</th><th>Animal</th><th>Level</th><th>Kills</th><th>Damage</th></tr>${rows}`));
    const b = el<HTMLButtonElement>('button', 'br-btn', 'Back to the lobby');
    b.addEventListener('click', () => this.onBack());
    box.append(b);
    this.end.append(box);
  }
  hideEnd() {
    this.end.hidden = true;
  }

  private buildPause() {
    const box = el('div', 'box wood');
    box.append(el('h2', '', 'Paused'));
    const resume = el<HTMLButtonElement>('button', 'br-btn', 'Resume');
    resume.addEventListener('click', () => this.onResume());
    const settings = el<HTMLButtonElement>('button', 'br-btn wood', 'Settings');
    settings.addEventListener('click', () => this.onSettings());
    const leave = el<HTMLButtonElement>('button', 'br-btn red', 'Leave the match');
    leave.addEventListener('click', () => this.onLeave());
    box.append(resume, settings, leave, el('small', '', 'The match keeps running. If you leave, an AI takes your animal.'));
    this.pause.append(box);
  }
  showPause(on: boolean) {
    this.pause.hidden = !on;
  }
  get pauseVisible() {
    return !this.pause.hidden;
  }
  /** Crosshair: combo pips, guard ring (gold during the parry window), counter-attack glow. */
  setReticle(you: YouState, guarding: boolean, show: boolean) {
    this.reticle.style.display = show ? '' : 'none';
    if (!show) return;
    const parry = guarding && (you.guardAge < 0.24 || !you.guard);
    this.reticle.classList.toggle('guard', guarding && !parry);
    this.reticle.classList.toggle('parry', guarding && parry);
    this.reticle.classList.toggle('counter', you.counter > 0);
    this.reticle.classList.toggle('wind', !!you.wind);
    const pips = this.reticle.querySelectorAll('.br-pips i');
    // `combo` is the swing that comes next; light the ones already thrown in this chain
    pips.forEach((p, i) => p.classList.toggle('on', i < you.combo));
    (this.reticle.querySelector('.br-guardtag') as HTMLElement).textContent = guarding ? (parry ? 'PARRY' : 'GUARD') : '';
    this.sta.classList.toggle('empty', you.sta < 8);
  }

  /** A big word in the middle of the screen: PARRY!, DODGED, GUARD BROKEN. */
  callout(text: string, color = '#fff') {
    const c = this.callouts;
    c.textContent = text;
    c.style.color = color;
    c.classList.remove('pop');
    void c.offsetWidth; // restart the animation
    c.classList.add('pop');
  }

  /** A kill streak banner: DOUBLE KILL, TRIPLE KILL, RAMPAGE... */
  streak(label: string, n: number) {
    const e = this.streakEl;
    (e.querySelector('b') as HTMLElement).textContent = label;
    (e.querySelector('span') as HTMLElement).textContent = `${n} KILLS IN A ROW`;
    e.classList.toggle('hot', n >= 4);
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop');
  }

  private flash(e: HTMLElement, cls: string) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
  }

  /** Your blow connected: a quick X on the crosshair (red for a heavy one). */
  hitMarker(heavy = false) {
    const x = this.reticle.querySelector('.x') as HTMLElement;
    x.classList.toggle('big', heavy);
    this.flash(x, 'go');
  }

  /** Level up: the level badge pops and a ring sweeps out from the animal. */
  levelUp() {
    this.flash(this.lvl, 'up');
    this.flash(this.levelRing, 'go');
  }

  /** Where the paper doll is drawn (CSS pixels from the top-left of the window). */
  dollRect() {
    const r = this.dollFrame.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 5, w: r.width - 10, h: r.height - 10 };
  }
  get visible() {
    return !this.root.hidden;
  }

  /** The animal card in the bottom-left corner: who you are, your class and what it costs and gives. */
  private renderInfo(you: YouState, def: AnimalDef, role: number) {
    const cls = CLASS_BY_ID.get(def.cls)!;
    this.dollFrame.style.display = role === 3 ? 'none' : '';
    this.info.style.display = role === 3 ? 'none' : '';
    const form = role === 2 ? 'Horde Leader' : role === 1 ? 'In the Gulag' : '';
    (this.dollFrame.querySelector('.tag') as HTMLElement).textContent = '';
    const key = JSON.stringify([def.id, you.lvl, you.alloc, you.picks, role, you.swarm?.tier]);
    if (key === this.infoKey) return;
    this.infoKey = key;
    const rows = STAT_KEYS.map((k) => {
      const v = def.stats[k] + you.alloc[k];
      return `<span>${STAT_NAMES[k]}</span><i style="width:${Math.min(100, (v / 50) * 100)}%"></i><em>${v}</em>`;
    }).join('');
    this.info.innerHTML =
      `<div class="hd"><span class="em">${EMOJI[def.id] ?? '🐾'}</span><div><b>${def.name}</b><small>${cls.icon} ${cls.name} · ${role === 2 ? `Tier ${you.swarm?.tier ?? 1}` : `Lv ${you.lvl}`}${form ? ` · ${form}` : ''}</small></div></div>` +
      `<div class="st">${rows}</div>` +
      `<div class="pk">${cls.perks.map((p) => `<div class="p">+ ${p}</div>`).join('')}${cls.drawbacks.map((p) => `<div class="d">− ${p.replace(/^[-−]\s?/, '')}</div>`).join('')}</div>`;
  }

  setLowHp(on: boolean) {
    this.lowhp.classList.toggle('on', on);
  }

  setCursorMode(on: boolean) {
    this.cursor.hidden = !on;
  }
  setLava(on: boolean) {
    this.lavaVig.style.opacity = on ? '1' : '0';
  }
  isEndVisible() {
    return !this.end.hidden;
  }
}
