// Remembers the colours you picked for each animal.
import { cleanPaint, type Paint } from '../../../shared/arena/paint';

const key = (animal: string) => `br-paint-${animal}`;

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
