import "server-only";
import { createHash } from "node:crypto";
import { db } from "./supabase";
import { rewriteSummary, type SummarySections } from "./ai";

export interface Paragraph {
  n: number;
  username: string;
  body: string;
  signed: boolean;
  gold: boolean;
  created_at: string;
}

export interface AuthorEntry {
  n: number;
  username: string;
  gold: boolean;
}

export interface Stats {
  paragraphs: number;
  authors: number;
  words: number;
  lastN: number;
}

export interface Summary {
  sections: SummarySections;
  afterN: number;
  updatedAt: string;
}

const PARAGRAPH_COLUMNS = "n, username, body, signed, gold, created_at";

/* ------------------------------ Lectura ------------------------------ */

export async function getStats(): Promise<Stats> {
  const { data, error } = await db().rpc("book_stats");
  if (error) throw error;
  const row = (data as { paragraphs: number; authors: number; words: number; last_n: number }[])[0];
  return {
    paragraphs: Number(row?.paragraphs ?? 0),
    authors: Number(row?.authors ?? 0),
    words: Number(row?.words ?? 0),
    lastN: Number(row?.last_n ?? 0),
  };
}

// Los últimos `limit` párrafos antes de `before` (sin incluirlo), en orden ascendente.
export async function paragraphsBefore(before: number, limit: number): Promise<Paragraph[]> {
  const { data, error } = await db()
    .from("paragraphs")
    .select(PARAGRAPH_COLUMNS)
    .lt("n", before)
    .order("n", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as Paragraph[]).reverse();
}

export async function paragraphsAfter(after: number, limit: number): Promise<Paragraph[]> {
  const { data, error } = await db()
    .from("paragraphs")
    .select(PARAGRAPH_COLUMNS)
    .gt("n", after)
    .order("n", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data as Paragraph[];
}

export async function paragraphsRange(from: number, to: number): Promise<Paragraph[]> {
  const { data, error } = await db()
    .from("paragraphs")
    .select(PARAGRAPH_COLUMNS)
    .gte("n", from)
    .lte("n", to)
    .order("n", { ascending: true });
  if (error) throw error;
  return data as Paragraph[];
}

export async function authorsBefore(before: number, limit: number): Promise<AuthorEntry[]> {
  const { data, error } = await db()
    .from("paragraphs")
    .select("n, username, gold")
    .lt("n", before)
    .order("n", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuthorEntry[]).reverse();
}

export async function searchAuthors(q: string, limit = 200): Promise<AuthorEntry[]> {
  // Escapa los comodines de LIKE para que "_" o "%" se busquen literalmente.
  const pattern = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const { data, error } = await db()
    .from("paragraphs")
    .select("n, username, gold")
    .ilike("username", pattern)
    .order("n", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuthorEntry[]).reverse(); // las más recientes, en orden de llegada
}

export async function getSummary(): Promise<Summary | null> {
  const { data, error } = await db()
    .from("book_summary")
    .select("sections, after_n, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { sections: data.sections as SummarySections, afterN: Number(data.after_n), updatedAt: data.updated_at };
}

/* ------------------------------ Escritura ------------------------------ */

export async function publishSubmission(id: string): Promise<number> {
  const { data, error } = await db().rpc("publish_submission", { p_id: id });
  if (error) throw error;
  return Number(data);
}

export async function cancelSubmission(id: string): Promise<void> {
  const { error } = await db().rpc("cancel_submission", { p_id: id });
  if (error) throw error;
}

// true si esta IP aún puede hacer esta acción (cada acción lleva su propio contador).
export async function rateAllowed(bucket: string, ip: string, max: number, windowSeconds: number): Promise<boolean> {
  const salt = process.env.RATE_LIMIT_SALT || "libro";
  const key = createHash("sha256").update(salt + ":" + bucket + ":" + ip).digest("hex").slice(0, 32);
  const { data, error } = await db().rpc("rate_check", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[rate] error comprobando el límite:", error.message);
    return true; // si falla el contador, no bloqueamos a nadie
  }
  return Boolean(data);
}

/* ------------------------------ Resumen ------------------------------ */

const SUMMARY_MAX_NEW = 60;

// Reescribe el resumen si hay párrafos nuevos. Evita trabajos duplicados y agrupa ráfagas:
// si se actualizó hace menos de 20 s y hay menos de 5 párrafos nuevos, espera al siguiente.
export async function refreshSummaryIfNeeded(opts: { force?: boolean } = {}): Promise<boolean> {
  const current = await getSummary();
  const stats = await getStats();
  if (!current || stats.lastN <= current.afterN) return false;

  const pending = stats.lastN - current.afterN;
  const ageMs = Date.now() - new Date(current.updatedAt).getTime();
  if (!opts.force && ageMs < 20_000 && pending < 5) return false;

  const { data: claimed, error: claimError } = await db().rpc("claim_summary_refresh");
  if (claimError) throw claimError;
  const claim = (claimed as { sections: SummarySections; after_n: number }[])[0];
  if (!claim) return false; // otro proceso ya lo está haciendo

  try {
    const fromN = Math.max(Number(claim.after_n), stats.lastN - SUMMARY_MAX_NEW);
    const fresh = await paragraphsAfter(fromN, SUMMARY_MAX_NEW);
    if (!fresh.length) return false;
    const skipped = fromN - Number(claim.after_n);
    const sections = await rewriteSummary(claim.sections, fresh, skipped);
    if (!sections) return false;
    const lastIncluded = fresh[fresh.length - 1].n;
    const { error } = await db()
      .from("book_summary")
      .update({ sections, after_n: lastIncluded, updated_at: new Date().toISOString(), refreshing_since: null })
      .eq("id", 1);
    if (error) throw error;
    return true;
  } finally {
    await db().from("book_summary").update({ refreshing_since: null }).eq("id", 1);
  }
}
