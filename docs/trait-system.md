# Trait system: design and implementation notes

Status: **proposal, not built yet.** Everything here is a recommendation to review. Open decisions are collected in [Open questions](#open-questions) at the end.

## 1. What a trait is

A **trait** is a body part you grow during a match: lungs, legs, fins, pincers, teeth, claws, a stinger, a plant-digesting stomach. It does two things:

1. **Changes how you play.** It adds numbers to your build (through the existing `Mods` system) and can change what your basic attack does (through the strike-chain effects).
2. **Changes how you look.** Other players can read your build from across the clearing: big fangs mean a biter, a stinger means poison, webbed feet mean a swimmer.

Traits sit **on top of** the species trees. Your animal and its evolution stage decide your base form, stats, class, skills and strike chain. Traits modify that form, so two players on the same animal can still end up playing differently.

### Goals

- Make every level-up choice feel like it changes something you can see.
- Let players build around a weakness or double down on a strength.
- Keep every build equally strong overall (see [Balance](#6-balance)).
- Reuse what exists: `Mods`, strike effects, the realistic model builders and the guidebook.

### Non-goals (v1)

- No persistence between matches: traits reset every match.
- No trading or dropping traits.
- No new combat verbs. Traits tune existing ones.

## 2. How it fits with what already exists

| Existing system | Where | How traits use it |
| --- | --- | --- |
| Stat points (`pts`, `alloc`, `derive`) | `shared/arena/animals.ts`, `match.ts` | Unchanged. Traits are a separate pool (see [section 3](#3-getting-traits)). |
| Passives and class numbers (`Mods`, `sumMods`) | `animals.ts` | A trait tier is a small `Mods` object, summed together with the form's passive, style and class. |
| Strike chains and effects (`bleed`, `slow`, `knock`, `stagger`) | `shared/arena/combat.ts` | A weapon trait can add an effect to strikes of a given kind (for example "bites also bleed"). |
| Evolution at level 5 and 10 | `evolveOptions` | Traits survive evolving. A few traits do not suit some forms (see [restrictions](#restrictions)). |
| Realistic models | `client/src/arena/realquad.ts`, `creatures.ts` | Each trait contributes small, named visual changes (see [section 5](#5-visuals)). |
| Guidebook | `client/src/arena/guidebook.ts` | A new Traits tab generated from the trait table. |

## 3. Getting traits

**Recommended: a fixed pick every three levels, separate from stat points.**

- Levels 3, 6, 9, 12, 15 and 18 each grant one **trait pick**. That is six picks, which matches how far the strongest players get in a normal match (top levels were 16 to 19 in the 20-bot tests).
- Each pick either **unlocks a new trait** at tier 1 or **upgrades** one you already own by a tier. Three tiers per trait.
- You have **three slots** in v1 (see [section 4](#4-slots-and-tiers)), so a full build is, for example, two traits at tier 3 and one at tier 2, or three at tier 2.
- Stat points keep working exactly as they do now.

Why not spend stat points on traits? It would make Health, Attack and the rest compete with traits for the same scarce 19 points, which would change the balance of every form. Keeping the pools separate lets traits be tuned on their own.

Alternative worth testing: traits cost 1, 2 and 3 stat points for tiers 1 to 3. That makes the choice harder but also makes tuning harder. See [open question 1](#open-questions).

## 4. Slots and tiers

Three slots in v1, two more once the first three are tuned.

| Slot | v1 | Later | What it covers |
| --- | --- | --- | --- |
| **Limbs** | yes | | How you move: legs, fins, webbed feet |
| **Weapon** | yes | | What your basic attack does: teeth, claws, pincers, stinger, horns |
| **Organs** | yes | | What your body can do: lungs, gills, plant stomach |
| Hide | | yes | Scales, fur, shell, spines: armour and resistances |
| Senses | | yes | Eyes, antennae, ears: detection and stealth |

One trait per slot at a time. Taking a different trait in a slot **replaces** the old one and refunds nothing, so the first choice matters. A pick can only upgrade or replace; it never adds a fourth trait.

Each trait has **three tiers**. Every tier is cumulative: tier 2 includes tier 1.

### Restrictions

A trait can list `forbids`, `requires` or `swim` conditions. For example, Gills require a form that can swim (`swim` is `semi` or `water`), and fish cannot take Webbed Feet because they already have fins. The picker only shows traits the current form can take, and the server checks again.

## 5. Visuals

Every trait names the changes it makes to the model. The builders already take a `spec` object, so a trait is a small patch applied before building.

| Trait | Visual change |
| --- | --- |
| Long Legs | Leg length +6% / +12% / +18% |
| Webbed Feet | Skin webbing between the toes, a paddle shape at tier 3 |
| Spring Legs | Larger thigh muscle, a more crouched stance |
| Teeth | Longer canines, a visible row of fangs, a wider jaw |
| Claws | Longer, curved claws on all four paws |
| Pincers | A pair of crab-like claws in front of the face (bugs and reptiles), oversized forelimbs (mammals) |
| Stinger | A barbed spike on the tail tip, venom gland swelling at tier 3 |
| Horns | Horns or a bony crest on the head |
| Lungs | A deeper, barrel-shaped chest |
| Gills | Gill slits behind the head (fish) or fringes at the neck (amphibians) |
| Plant Stomach | A rounder belly |

Rules:

- Visual changes are **cosmetic and deterministic**. The same traits always give the same look, so they can be rebuilt on every client from a small packed number.
- A trait must be readable at the distance you normally fight at. If you cannot tell it apart at 15 m, make it bigger.
- Traits must not break the animation rigs: they change geometry sizes and add parts to existing articulated groups (head, tail, legs), never new moving groups.

## 6. Balance

### The budget

Every trait tier has a **power budget** so no build is strictly better than another.

| Tier | Budget |
| --- | --- |
| 1 | 1.0 |
| 2 | 2.2 (cumulative) |
| 3 | 3.6 (cumulative) |

Each effect has a price in budget units. Starting coefficients (to be tuned in playtests):

| Effect | Cost per unit |
| --- | --- |
| +1% damage | 0.15 |
| +1% speed | 0.20 |
| +1% max health | 0.10 |
| +1% damage reduction | 0.35 |
| +1% senses range | 0.04 |
| +1 s bleed on basic hits | 0.40 |
| Extra utility (breath underwater, eat plants, climb) | 0.6 to 1.2 each |

Every tier 3 trait also carries a **drawback** worth about 25% of its budget (slower, thirstier, noisier, more fragile in some situation). A trait that has no drawback has to be a weaker trait.

### Guardrails

- A form's strongest trait cannot raise its damage per second or its effective health by more than 15% on its own. Add a test for this.
- Weapon traits must keep the strike chain's total damage per second within 1% of the base, as the strike chains already do. Weapon traits trade effects for raw numbers; they do not add damage.
- No trait gives more than one hard crowd control effect.
- The bots and the 20-bot match test run with random trait picks, and the win rate of any single trait must stay within 10% of the average over 50 matches.

## 7. Trait catalogue (v1)

All numbers are the starting point for tuning. "T1 / T2 / T3" are cumulative.

### Limbs

| Trait | T1 | T2 | T3 | Drawback (T3) |
| --- | --- | --- | --- | --- |
| **Long Legs** | +4% speed | +8% speed, dash recharges 10% faster | +12% speed, dash recharges 20% faster | -8% health |
| **Webbed Feet** | +15% speed in water | +30% speed in water, can wade deep water | +50% speed in water, can cross rivers in a dash | -5% speed on land |
| **Spring Legs** | Jump 15% higher | Jump 30% higher, soft landings | Jump 50% higher, a leap strike on landing | -10% stamina |

### Weapon

| Trait | T1 | T2 | T3 | Drawback (T3) |
| --- | --- | --- | --- | --- |
| **Teeth** | Bites also bleed for 1 s | Bleed 2 s, +8% reach on bites | Bleed 3 s, the finisher tears a larger wound | Hits cost +10% stamina |
| **Claws** | +6% reach | +10% reach, rakes hit twice as often to stagger | +14% reach, every third hit staggers | -6% max health |
| **Pincers** | Heavy strikes grab for 0.3 s | Grab 0.6 s, +8% damage to a grabbed target | Grab 1 s, the grabbed target cannot dash | -10% speed |
| **Stinger** | Jabs slow for 1 s | Slow 1.5 s, jabs apply a small poison | Slow 2 s, poison 3 s, venom stacks | Attacks are 8% slower |
| **Horns** | Rams knock back 20% further | +10% damage on rams, a charge staggers | Rams knock 50% further, a charge breaks a guard | Cannot hide in bushes |

### Organs

| Trait | T1 | T2 | T3 | Drawback (T3) |
| --- | --- | --- | --- | --- |
| **Lungs** | Stay underwater 2 s longer | Hold breath 6 s longer, ambush from water +10% | Hold breath 12 s longer, ambush from water +20% | -6% speed on land |
| **Gills** | Breathe underwater (swimmers only) | Submerge twice as long | Never need to surface, +15% damage from water | Stamina drains on dry land |
| **Plant Stomach** | Berries and herbs heal 30% more | 60% more, herbs also restore stamina | 100% more, eat plants while moving | Meat heals 25% less |

Notes:

- Teeth, Claws and Horns work through the existing strike effects: they set the `fx` field on strikes of a chosen kind when the chain is read. No new combat code is needed for the first tier of each.
- Pincers need one new rule (a short grab on a heavy strike). Stinger needs the poison status, which is a bleed variant.
- Lungs and Gills need the swimming checks in `match.ts` to read a trait value instead of a constant.

## 8. Implementation plan

### Data (shared)

A new file `shared/arena/traits.ts`.

```ts
export type TraitSlot = 'limbs' | 'weapon' | 'organs'; // 'hide' | 'senses' later

export interface TraitTier {
  desc: string; // one line for the UI and the guidebook
  mods?: Mods; // folded into sumMods() with the form's passives
  strikeFx?: { kinds: StrikeKind[]; fx: StrikeFx; dur?: number }; // adds an effect to matching strikes
  reach?: number; // multiplies strike reach
  water?: { breath?: number; speed?: number; deep?: boolean }; // swimming rules
  eat?: { plants?: number; meat?: number };
  visual?: Partial<TraitVisual>; // see below
}

export interface TraitDef {
  id: string; // 'teeth', 'long_legs', ...
  name: string;
  slot: TraitSlot;
  icon: string;
  blurb: string;
  tiers: [TraitTier, TraitTier, TraitTier];
  drawback: string; // shown at tier 3
  allow?: (def: AnimalDef) => boolean; // for example, gills need a swimmer
}

export interface TraitVisual {
  legLen: number; fangs: number; claws: number; horns: number; stinger: number;
  belly: number; webbing: number; gills: boolean; pincers: number;
}

export const TRAITS: TraitDef[] = [ /* the catalogue in section 7 */ ];
export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
export const TRAIT_PICK_LEVELS = [3, 6, 9, 12, 15, 18] as const;
```

Helpers in the same file:

- `traitMods(traits)` returns the summed `Mods` for the build.
- `strikesFor(animalId, traits)` returns the strike chain with trait effects applied (a thin wrapper over `comboOf`).
- `packTraits` / `unpackTraits` turn the build into an integer for the network (see below).
- `canTake(def, slot, traitId)` is the single place that checks restrictions.

### Server (`shared/arena/match.ts`)

- `Fighter` gains `traits: Partial<Record<TraitSlot, { id: string; tier: 1 | 2 | 3 }>>` and `traitPicks: number` (unspent picks).
- `gainXp` grants a pick when the new level is in `TRAIT_PICK_LEVELS`.
- New client message `{ t: 'mtrait', slot, id }`. The server accepts it only if the fighter is alive, has a pick, the trait is allowed for the form and the slot, and the tier is at most 3. It then upgrades or replaces, spends the pick and recomputes `f.mods`.
- `f.mods = sumMods([f.def.innate, f.def.style, classSkill, ...traits])` is already the pattern; traits are one more entry in that list.
- `comboOf` is read through `strikesFor` in `basicAttack`, `strikeNow` and `resolveSwing`.
- Water rules read the trait values instead of fixed constants.
- Bots pick traits by role (a table keyed by class), so the 20-bot test exercises the system.

### Protocol (`shared/arena/proto.ts`)

- `YouState` gains `traits` (the list with tiers), `traitPicks` and `traitOptions` (what the player may take right now).
- Other players need the **look** only. Add one packed integer `tr` to each entry in the roster message and update it with a `{ k: 'trait', id, tr }` event when it changes. Fighter snapshots stay the same size, which matters for the bandwidth work.
- Packing: three slots times (4 bits for the trait index within the slot, 2 bits for the tier) is 18 bits, which fits comfortably in one number.

### Client

- **Model.** `makePlayerRig(animal, paint, key, traits)` applies the visual patches before building. A change of traits rebuilds the rig. This is rare (at most six times a match), so that is fine.
- **Panel.** The Tab panel (evolve and stats) gets a **Traits** section with three slots, the unspent picks, and cards showing each choice with its tiers, text and drawback. Locked traits show why (for example "Needs a swimming form").
- **HUD.** A small badge appears beside the level when a pick is waiting, the same way the stat-point badge works.
- **Guidebook.** A Traits tab generated from `TRAITS`, so it never goes stale.
- **Menu.** Nothing to choose before a match in v1.

### Tests

New `shared/arena/traits.test.ts`:

- Every trait has three tiers and each tier's price is at or below its budget.
- Every tier is a strict superset of the tier before it.
- `canTake` rejects forbidden pairs (for example Gills on a land form).
- A fighter cannot hold two traits in the same slot, cannot exceed three, and cannot pick without a pick.
- Weapon traits leave the strike chain's damage per second within 1% of the base.
- `packTraits` round-trips for every combination.
- Run the 20-bot match with traits on and check win rates by trait over many seeds.

## 9. Phases

| Phase | Scope | Exit gate |
| --- | --- | --- |
| 1. Data and server | `traits.ts`, picks every three levels, `mtrait` message, mods and strike effects, tests | The 20-bot match finishes with traits on and the budget tests pass |
| 2. Panel and HUD | Traits section in the Tab panel, pick badge, guidebook tab | A player can pick and see the change in the stats |
| 3. Visuals | Model patches for all eleven traits, rig rebuild on change | Each trait is recognisable at 15 m in a screenshot sheet |
| 4. Balance | Tune numbers against 50-match bot runs and real playtests | No trait is above or below 10% of the average win rate |
| 5. More slots | Hide and Senses, then cross-tree traits if wanted | New slots pass the same gates |

## 10. Open questions

1. **Separate pool or stat points?** This document recommends a separate pick every three levels. The alternative is to spend stat points on traits.
2. **Replace or refund?** The proposal says replacing a trait refunds nothing. A refund (for example, half the picks back) would make experimenting cheaper.
3. **Do traits replace the stage 2 and 3 forms?** The proposal keeps the forms and the trees. A bolder version makes the later stages mostly cosmetic and puts the power in traits. That makes the tree smaller but the choices bigger.
4. **How many slots at launch?** Three is easier to balance. Five matches the original idea of lungs, legs, fins, pincers, teeth, claws, stinger and stomach all being available.
5. **Should some traits be locked behind behaviour?** For example, Gills only after spending time in water, or Stinger only after a kill with a jab. This ties into widening the evolution tree.
6. **Does the whole lobby see your traits?** The proposal shows them visually only. Showing them as nameplate icons would make builds easier to read but give away information.
7. **Match-only or persistent?** v1 resets every match. Persistent unlocks would need accounts to store them in Supabase.
