// Calendario de los párrafos de la casa: los que escribe la propia web con autores ficticios
// para que el libro tenga movimiento y no pierda el hilo hasta que lo llenen los lectores.
//
// Cada día se tira un dado, sin patrón por día de la semana: unos días ninguno, otros 1, 2 o 3,
// a horas al azar entre las 9:00 y las 23:45 (hora de Madrid). De media salen unos 10 a la semana.
// El dado es determinista por fecha: cualquier servidor que lo consulte ve el mismo plan del día.

export const HOUSE_COUNT_WEIGHTS = [0.2, 0.35, 0.3, 0.15] as const; // probabilidad de 0, 1, 2 y 3 párrafos
export const HOUSE_DAY_START_MIN = 9 * 60;
export const HOUSE_DAY_END_MIN = 23 * 60 + 45;
export const HOUSE_MIN_GAP_MIN = 40; // minutos mínimos entre dos párrafos de la casa

// Generador pseudoaleatorio con semilla (FNV-1a + mulberry32): mismo texto, misma secuencia.
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function houseCountFor(r: number): number {
  let acc = 0;
  for (let i = 0; i < HOUSE_COUNT_WEIGHTS.length; i++) {
    acc += HOUSE_COUNT_WEIGHTS[i];
    if (r < acc) return i;
  }
  return HOUSE_COUNT_WEIGHTS.length - 1;
}

// Minutos del día (hora de Madrid) en los que toca publicar, ordenados. dayKey = "AAAA-MM-DD".
export function housePlan(dayKey: string, salt = ""): number[] {
  const rand = seededRandom(`casa:${salt}:${dayKey}`);
  const count = houseCountFor(rand());
  const span = HOUSE_DAY_END_MIN - HOUSE_DAY_START_MIN;
  const slots: number[] = [];
  for (let tries = 0; slots.length < count && tries < 200; tries++) {
    const t = HOUSE_DAY_START_MIN + Math.floor(rand() * span);
    if (slots.every((s) => Math.abs(s - t) >= HOUSE_MIN_GAP_MIN)) slots.push(t);
  }
  return slots.sort((x, y) => x - y);
}

// Cuántos párrafos del plan ya deberían estar publicados a esta hora.
export function dueSlots(plan: number[], minutesNow: number): number {
  return plan.filter((t) => t <= minutesNow).length;
}

// Fecha y hora de Madrid para un instante dado, y el instante en que empezó ese día.
export function madridClock(now: Date): { dayKey: string; minutes: number; dayStart: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const elapsedMs = (minutes * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return { dayKey: `${parts.year}-${parts.month}-${parts.day}`, minutes, dayStart: new Date(now.getTime() - elapsedMs) };
}

/* Cómo será cada párrafo: se sortea en cada publicación. */

export interface HouseBrief {
  length: "corto" | "medio" | "largo";
  maxChars: number;
  minChars: number;
  tone: string;
  register: "cuidado" | "informal";
  signed: boolean;
  gold: boolean;
}

export const HOUSE_TONES = [
  "gracioso, con una ocurrencia o una exageración",
  "de intriga: añade una pista pequeña o un detalle inquietante, sin resolver nada",
  "emotivo: un recuerdo familiar o de alguien que conoció a Paco",
  "teoría de lector: alguien que opina qué pudo pasar",
  "reacción a lo último que se ha escrito, siguiéndolo o llevándole un poco la contraria",
  "costumbrista: un detalle de época, del barrio o de la familia",
  "un giro pequeño que abra una puerta nueva sin romper la historia",
] as const;

export function pickBrief(rand: () => number = Math.random): HouseBrief {
  const r = rand();
  const length = r < 0.35 ? "corto" : r < 0.75 ? "medio" : "largo";
  const [minChars, maxChars] = length === "corto" ? [30, 140] : length === "medio" ? [150, 320] : [330, 490];
  const gold = rand() < 0.06;
  return {
    length,
    minChars,
    maxChars,
    tone: HOUSE_TONES[Math.floor(rand() * HOUSE_TONES.length)],
    register: rand() < 0.4 ? "informal" : "cuidado",
    signed: gold || rand() < 0.35,
    gold,
  };
}
