// Cada cuántos párrafos se reescribe el resumen.
//
// Norma general: cada 5 párrafos. Si el libro va rápido, el lote crece para que el resumen
// se reescriba como mucho unas 10 veces al día, y así el gasto de Claude no sube con el volumen:
//   hasta 50 párrafos al día → cada 5 · hasta 100 → cada 10 · hasta 200 → cada 20
//   hasta 500 → cada 50 · más de 500 → cada 100
// Si el libro va lento y no se llega al lote, se reescribe igualmente una vez al día con lo que haya.

export const SUMMARY_BATCHES = [5, 10, 20, 50, 100] as const;
export const SUMMARY_REWRITES_PER_DAY = 10;
export const SUMMARY_MAX_WAIT_MS = 24 * 60 * 60 * 1000;

// Umbrales de volumen (párrafos en 24 h) en los que cambia el lote: 50, 100, 200 y 500.
export const SUMMARY_RATE_STEPS = SUMMARY_BATCHES.slice(0, -1).map((b) => b * SUMMARY_REWRITES_PER_DAY);

export function summaryBatchSize(paragraphsLast24h: number): number {
  const wanted = Math.ceil(Math.max(0, paragraphsLast24h) / SUMMARY_REWRITES_PER_DAY);
  return SUMMARY_BATCHES.find((b) => b >= wanted) ?? SUMMARY_BATCHES[SUMMARY_BATCHES.length - 1];
}

export function shouldRefreshSummary(p: { pending: number; every: number; sinceLastRewriteMs: number }): boolean {
  if (p.pending <= 0) return false;
  return p.pending >= p.every || p.sinceLastRewriteMs >= SUMMARY_MAX_WAIT_MS;
}
