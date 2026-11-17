import { after, type NextRequest } from "next/server";
import { getStats, getSummary, paragraphsAfter, refreshSummaryIfNeeded, summaryEvery } from "@/lib/book";
import { runHouseWriter } from "@/lib/house";
import { shouldRefreshSummary } from "@/lib/summary-policy";
import { cached, fail, int } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

// Las visitas también despiertan al escritor de la casa, como mucho una vez por minuto en cada servidor.
let lastHouseCheck = 0;

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
    if (Date.now() - lastHouseCheck > 60_000) {
      lastHouseCheck = Date.now();
      after(() => runHouseWriter().catch((e) => console.error("[casa]", e)));
    }
    return cached({ stats, summary, summaryEvery: every, paragraphs: fresh }, 3);
  } catch (e) {
    console.error("[live]", e);
    return fail(500, "No hemos podido actualizar el libro.");
  }
}
