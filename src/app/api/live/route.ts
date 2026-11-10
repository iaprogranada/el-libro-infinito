import { after, type NextRequest } from "next/server";
import { getStats, getSummary, paragraphsAfter, refreshSummaryIfNeeded, summaryEvery } from "@/lib/book";
import { shouldRefreshSummary } from "@/lib/summary-policy";
import { cached, fail, int } from "@/lib/http";

export const runtime = "nodejs";

// Lo que la página consulta cada pocos segundos: párrafos nuevos, contadores y resumen.
export async function GET(req: NextRequest) {
  const afterN = int(req.nextUrl.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
  try {
    const [stats, summary, fresh] = await Promise.all([getStats(), getSummary(), paragraphsAfter(afterN, 50)]);
    const every = await summaryEvery(stats.lastN);
    // Red de seguridad: si ya toca reescribir el resumen y no se ha hecho al publicar, se hace aquí en segundo plano.
    if (
      summary &&
      shouldRefreshSummary({
        pending: stats.lastN - summary.afterN,
        every,
        sinceLastRewriteMs: Date.now() - new Date(summary.updatedAt).getTime(),
      })
    ) {
      after(() => refreshSummaryIfNeeded({ stats, summary }).catch((e) => console.error("[resumen]", e)));
    }
    return cached({ stats, summary, summaryEvery: every, paragraphs: fresh }, 3);
  } catch (e) {
    console.error("[live]", e);
    return fail(500, "No hemos podido actualizar el libro.");
  }
}
