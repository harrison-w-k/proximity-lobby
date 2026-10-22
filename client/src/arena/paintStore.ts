// Remembers the colours you picked for each animal.
import { ANIMAL_BY_ID } from '../../../shared/arena/animals';
import { cleanPaint, type Paint } from '../../../shared/arena/paint';

// one set of colours per evolution tree, so your animal keeps its colours as it evolves
const key = (animal: string) => `br-paint-${ANIMAL_BY_ID.get(animal)?.tree ?? animal}`;

export function loadPaint(animal: string): Paint | undefined {
  try {
    const raw = localStorage.getItem(key(animal));
    return raw ? cleanPaint(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function savePaint(animal: string, paint: Paint | undefined) {
  try {
    if (paint) localStorage.setItem(key(animal), JSON.stringify(paint));
    else localStorage.removeItem(key(animal));
  } catch {
    /* storage unavailable */
  }
}
