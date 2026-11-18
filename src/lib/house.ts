import "server-only";
import { moderate, writeHouseParagraph } from "./ai";
import { authorsBefore, getStats, getSummary, paragraphsBefore, paragraphsRange, publishSubmission, refreshSummaryIfNeeded } from "./book";
import { HOUSE_MIN_GAP_MIN, dueSlots, goldTargetByNow, housePlan, lengthFits, madridClock, pickBrief } from "./house-plan";
import { db } from "./supabase";
import { checkForm, normalizeText, normalizeUsername, quickReject } from "./validation";

// Párrafos de la casa: la propia web escribe de vez en cuando con autores ficticios (ver house-plan.ts).
// Para apagarlo, poner HOUSE_ENABLED = false.
export const HOUSE_ENABLED = true;
const HOUSE_REF = "house"; // marca en submissions.provider_ref (los de verdad llevan el id del pago)
const RETURNING_AUTHOR_CHANCE = 0.15; // a veces vuelve a escribir un autor ficticio que ya salió

function salt(): string {
  return process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

// Un único candado por clave: devuelve true solo a la primera llamada dentro de la ventana.
async function claimOnce(key: string, windowSeconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("rate_check", { p_key: key, p_max: 1, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[casa] no se pudo coger el turno:", error.message);
    return false;
  }
  return Boolean(data);
}

async function houseToday(dayStart: Date): Promise<{ done: number; lastAt: number | null }> {
  const { data, error } = await db()
    .from("submissions")
    .select("created_at")
    .eq("provider_ref", HOUSE_REF)
    .eq("status", "published")
    .gte("created_at", dayStart.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data as { created_at: string }[];
  return { done: rows.length, lastAt: rows[0] ? Date.parse(rows[0].created_at) : null };
}

async function fictionalAuthors(): Promise<string[]> {
  const [seed, house] = await Promise.all([
    db().from("paragraphs").select("username").is("submission_id", null).gt("n", 1).limit(100),
    db().from("submissions").select("username").eq("provider_ref", HOUSE_REF).eq("status", "published").limit(500),
  ]);
  const names = [...(seed.data ?? []), ...(house.data ?? [])].map((r) => (r as { username: string }).username);
  return [...new Set(names)];
}

// Dorados publicados este mes (de la casa y de pago).
async function goldsThisMonth(monthStart: Date): Promise<number> {
  const { count, error } = await db()
    .from("paragraphs")
    .select("n", { count: "exact", head: true })
    .eq("gold", true)
    .gte("created_at", monthStart.toISOString());
  if (error) throw error;
  return count ?? 0;
}

// Escribe un párrafo con Claude, lo pasa por el filtro y devuelve el texto listo (sin publicarlo).
async function draft(): Promise<{ username: string; body: string; signed: boolean; gold: boolean } | null> {
  const stats = await getStats();
  const [first, recent, summary, authors, fictional] = await Promise.all([
    paragraphsRange(1, 1),
    paragraphsBefore(stats.lastN + 1, 25),
    getSummary(),
    authorsBefore(stats.lastN + 1, 1000),
    fictionalAuthors(),
  ]);
  const existing = [...new Set(authors.map((a) => a.username))];
  const brief = pickBrief(Math.random, { prevSigned: recent.at(-1)?.signed ?? false });
  const clock = madridClock(new Date());
  if (!brief.gold && (await goldsThisMonth(clock.monthStart)) < goldTargetByNow(clock.dayOfMonth)) {
    brief.gold = true;
    brief.signed = true;
  }
  const lastAuthors = new Set(recent.slice(-8).map((p) => p.username.toLocaleLowerCase("es-ES")));
  const returning = fictional.filter((u) => !lastAuthors.has(u.toLocaleLowerCase("es-ES")));
  const author =
    Math.random() < RETURNING_AUTHOR_CHANCE && returning.length
      ? returning[Math.floor(Math.random() * returning.length)]
      : undefined;

  const out = await writeHouseParagraph({
    premise: first[0]?.body ?? "",
    summary: summary?.sections ?? null,
    recent,
    existingAuthors: existing.slice(-400),
    brief: {
      form: brief.form,
      targetChars: brief.targetChars,
      minChars: brief.minChars,
      maxChars: brief.maxChars,
      voice: brief.voice,
      nameStyle: brief.nameStyle.description,
      author,
    },
  });
  if (!out) return null;

  const username = author ?? normalizeUsername(out.username);
  const body = normalizeText(out.body);
  const formError = checkForm(username, body);
  if (formError) {
    console.error("[casa] el texto no cumple el formato:", formError);
    return null;
  }
  if (!author && !brief.nameStyle.repeatable && existing.some((u) => u.toLocaleLowerCase("es-ES") === username.toLocaleLowerCase("es-ES"))) {
    console.error("[casa] nombre repetido, se descarta:", username);
    return null;
  }
  if (!lengthFits(body, brief)) {
    console.error(`[casa] largo fuera de lo pedido (${body.length}, pedido ${brief.minChars}-${brief.maxChars}), se descarta`);
    return null;
  }
  if (quickReject(username, body)) return null;
  const verdict = await moderate(username, body);
  if (!verdict.ok) {
    console.error("[casa] el filtro no lo aprueba");
    return null;
  }
  return { username, body, signed: brief.signed, gold: brief.gold };
}

export type HouseResult = { status: "off" | "nothing_due" | "waiting" | "busy" | "failed" } | { status: "published"; n: number };

// Publica un párrafo de la casa si el plan de hoy lo pide. Se puede llamar todas las veces que se quiera:
// como mucho publica uno por llamada, deja al menos 40 minutos entre dos y nunca pasa del plan del día.
export async function runHouseWriter(now = new Date()): Promise<HouseResult> {
  return houseStep(now, { ignoreGap: false, refreshSummary: true });
}

// Repaso de la noche (cron diario de Vercel): publica lo que quede pendiente del plan de hoy,
// por si en todo el día no ha habido visitas ni ha saltado la tarea de GitHub.
export async function catchUpHouseWriter(): Promise<HouseResult[]> {
  const results: HouseResult[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await houseStep(new Date(), { ignoreGap: true, refreshSummary: false });
    results.push(r);
    if (r.status !== "published") break;
  }
  if (results.some((r) => r.status === "published")) {
    await refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e));
  }
  return results;
}

async function houseStep(now: Date, opts: { ignoreGap: boolean; refreshSummary: boolean }): Promise<HouseResult> {
  if (!HOUSE_ENABLED) return { status: "off" };
  const clock = madridClock(now);
  const due = dueSlots(housePlan(clock.dayKey, salt()), clock.minutes);
  if (due === 0) return { status: "nothing_due" };

  const today = await houseToday(clock.dayStart);
  if (today.done >= due) return { status: "nothing_due" };
  if (!opts.ignoreGap && today.lastAt && now.getTime() - today.lastAt < HOUSE_MIN_GAP_MIN * 60_000) return { status: "waiting" };

  // Un solo servidor escribe cada turno; si falla, se reintenta en la siguiente franja de 10 minutos.
  const bucket = Math.floor(now.getTime() / 600_000);
  if (!(await claimOnce(`casa:${clock.dayKey}:${today.done + 1}:${bucket}`, 3600))) return { status: "busy" };

  const p = await draft();
  if (!p) return { status: "failed" };

  // Por si otro servidor publicó mientras se escribía.
  const again = await houseToday(clock.dayStart);
  if (again.done !== today.done) return { status: "busy" };

  const { data: sub, error } = await db()
    .from("submissions")
    .insert({ username: p.username, body: p.body, signed: p.signed, gold: p.gold, amount_cents: 0, provider_ref: HOUSE_REF })
    .select("id")
    .single();
  if (error || !sub) {
    console.error("[casa] no se pudo guardar:", error?.message);
    return { status: "failed" };
  }
  const n = await publishSubmission(sub.id);
  if (opts.refreshSummary) await refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e));
  return { status: "published", n };
}

// Para ver cómo escribe, sin publicar nada. Limitado a 5 al día para no gastar.
export async function previewHouseParagraph(): Promise<{ username: string; body: string; signed: boolean; gold: boolean } | null> {
  const { dayKey } = madridClock(new Date());
  for (let i = 1; i <= 5; i++) {
    if (await claimOnce(`casa-prueba:${dayKey}:${i}`, 2 * 86400)) return draft();
  }
  return null;
}

// El plan de hoy, para comprobarlo (horas de Madrid).
export function todayPlan(now = new Date()): { day: string; times: string[]; due: number } {
  const clock = madridClock(now);
  const plan = housePlan(clock.dayKey, salt());
  const hhmm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  return { day: clock.dayKey, times: plan.map(hhmm), due: dueSlots(plan, clock.minutes) };
}
