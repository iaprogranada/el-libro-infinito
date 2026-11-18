import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOUSE_DAY_END_MIN,
  HOUSE_DAY_START_MIN,
  HOUSE_MIN_GAP_MIN,
  dueSlots,
  goldTargetByNow,
  houseCountFor,
  lengthFits,
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

test("los encargos se parecen al arranque: muchas frases cortas, pocas largas y poca firma", () => {
  const rand = seededRandom("prueba");
  const briefs = Array.from({ length: 2000 }, () => pickBrief(rand));
  for (const b of briefs) {
    assert.ok(b.maxChars <= 480 && b.minChars < b.maxChars);
    assert.ok(b.targetChars >= b.minChars && b.targetChars <= b.maxChars);
    if (b.gold) assert.ok(b.signed);
  }
  const share = (f: (b: (typeof briefs)[number]) => boolean) => briefs.filter(f).length / briefs.length;
  const short = share((b) => b.targetChars <= 120);
  const long = share((b) => b.targetChars > 300);
  assert.ok(short > 0.35 && short < 0.6, `cortos ${short}`);
  assert.ok(long > 0.12 && long < 0.35, `largos ${long}`);
  const signed = share((b) => b.signed);
  assert.ok(signed > 0.17 && signed < 0.3, `firmados ${signed}`);
  assert.ok(new Set(briefs.map((b) => b.voice)).size >= 8);
});

test("después de un párrafo firmado, la firma casi nunca se repite", () => {
  const rand = seededRandom("firmas");
  const after = Array.from({ length: 2000 }, () => pickBrief(rand, { prevSigned: true }));
  const signed = after.filter((b) => b.signed && !b.gold).length / after.length;
  assert.ok(signed < 0.1, `firmados tras firmado ${signed}`);
});

test("el largo escrito tiene que parecerse al pedido", () => {
  const brief = { minChars: 20, maxChars: 90 };
  assert.equal(lengthFits("Las croquetas, por cierto, también desaparecieron.", brief), true);
  assert.equal(lengthFits("x".repeat(300), brief), false);
  assert.equal(lengthFits("Ya", { minChars: 200, maxChars: 480 }), false);
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

test("al menos 2 dorados al mes: el 1.º hacia el día 13 y el 2.º hacia el 25", () => {
  assert.equal(goldTargetByNow(1), 0);
  assert.equal(goldTargetByNow(12), 0);
  assert.equal(goldTargetByNow(13), 1);
  assert.equal(goldTargetByNow(24), 1);
  assert.equal(goldTargetByNow(25), 2);
  assert.equal(goldTargetByNow(31), 2);
});

test("un día con plan fijado a mano usa ese plan", () => {
  assert.deepEqual(housePlan("2026-11-17", "x"), [19 * 60 + 45, 20 * 60 + 55]);
});

test("inicio de mes en hora de Madrid", () => {
  const c = madridClock(new Date("2026-11-17T18:40:00Z"));
  assert.equal(c.dayOfMonth, 17);
  assert.equal(c.monthStart.toISOString(), "2026-10-31T23:00:00.000Z");
});
