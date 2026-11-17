import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOUSE_DAY_END_MIN,
  HOUSE_DAY_START_MIN,
  HOUSE_MIN_GAP_MIN,
  dueSlots,
  houseCountFor,
  housePlan,
  madridClock,
  pickBrief,
  seededRandom,
} from "../src/lib/house-plan.ts";

function days(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 10, 17));
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test("el plan de un día es siempre el mismo", () => {
  assert.deepEqual(housePlan("2026-11-17", "x"), housePlan("2026-11-17", "x"));
});

test("cada día 0 a 3 párrafos, a horas razonables y separados", () => {
  for (const day of days(400)) {
    const plan = housePlan(day, "x");
    assert.ok(plan.length >= 0 && plan.length <= 3);
    for (const t of plan) assert.ok(t >= HOUSE_DAY_START_MIN && t < HOUSE_DAY_END_MIN);
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i] - plan[i - 1] >= HOUSE_MIN_GAP_MIN);
  }
});

test("sin patrón semanal y con unos 10 a la semana de media", () => {
  const all = days(700);
  const counts = all.map((d) => housePlan(d, "x").length);
  const perWeek = (counts.reduce((a, b) => a + b, 0) / all.length) * 7;
  assert.ok(perWeek > 8.5 && perWeek < 11, `media semanal ${perWeek}`);
  // Hay días de 0 y días de 3, y los domingos también tienen párrafos.
  assert.ok(counts.includes(0) && counts.includes(3));
  const sundays = all.filter((d) => new Date(d + "T12:00:00Z").getUTCDay() === 0);
  assert.ok(sundays.some((d) => housePlan(d, "x").length > 0));
});

test("cuántos tocan a cada hora", () => {
  assert.equal(dueSlots([600, 900, 1300], 599), 0);
  assert.equal(dueSlots([600, 900, 1300], 600), 1);
  assert.equal(dueSlots([600, 900, 1300], 1400), 3);
});

test("reparto del dado: 0, 1, 2 y 3", () => {
  assert.equal(houseCountFor(0), 0);
  assert.equal(houseCountFor(0.19), 0);
  assert.equal(houseCountFor(0.2), 1);
  assert.equal(houseCountFor(0.6), 2);
  assert.equal(houseCountFor(0.99), 3);
});

test("hora de Madrid en invierno y en verano", () => {
  const winter = madridClock(new Date("2026-11-17T18:25:00Z"));
  assert.equal(winter.dayKey, "2026-11-17");
  assert.equal(winter.minutes, 19 * 60 + 25);
  assert.equal(winter.dayStart.toISOString(), "2026-11-16T23:00:00.000Z");
  const summer = madridClock(new Date("2026-07-01T22:30:00Z"));
  assert.equal(summer.dayKey, "2026-07-02");
  assert.equal(summer.minutes, 30);
});

test("los encargos varían y respetan los límites", () => {
  const rand = seededRandom("prueba");
  const briefs = Array.from({ length: 500 }, () => pickBrief(rand));
  for (const b of briefs) {
    assert.ok(b.maxChars <= 490 && b.minChars < b.maxChars);
    if (b.gold) assert.ok(b.signed);
  }
  assert.ok(new Set(briefs.map((b) => b.length)).size === 3);
  const golds = briefs.filter((b) => b.gold).length;
  const signed = briefs.filter((b) => b.signed).length;
  assert.ok(golds >= 3 && golds <= 35, `dorados ${golds}`);
  assert.ok(signed > 90 && signed < 190, `firmados ${signed}`);
});

test("el tipo de nombre se sortea: apodos, nombres, descripciones, iniciales…", () => {
  const rand = seededRandom("nombres");
  const kinds = Array.from({ length: 1000 }, () => pickBrief(rand).nameStyle.kind);
  const count = (k: string) => kinds.filter((x) => x === k).length;
  for (const k of ["apodo", "nombre", "nombre_completo", "descripcion", "iniciales", "nombre_y_lugar", "usuario_de_internet", "anonimo"]) {
    assert.ok(count(k) > 15, `${k}: ${count(k)}`);
  }
  // El nombre real completo es minoría.
  assert.ok(count("nombre_completo") < 150);
});
