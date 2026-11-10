import { after, type NextRequest } from "next/server";
import { getStats, getSummary, paragraphsAfter, refreshSummaryIfNeeded } from "@/lib/book";
import { cached, fail, int } from "@/lib/http";

export const runtime = "nodejs";

// Lo que la página consulta cada pocos segundos: párrafos nuevos, contadores y resumen.
export async function GET(req: NextRequest) {
  const afterN = int(req.nextUrl.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
  try {
    const [stats, summary, fresh] = await Promise.all([getStats(), getSummary(), paragraphsAfter(afterN, 50)]);
    // Si el resumen se ha quedado atrás más de un minuto, se pone al día en segundo plano.
    if (summary && stats.lastN > summary.afterN && Date.now() - new Date(summary.updatedAt).getTime() > 60_000) {
      after(() => refreshSummaryIfNeeded({ force: true }).catch((e) => console.error("[resumen]", e)));
    }
    return cached({ stats, summary, paragraphs: fresh }, 3);
  } catch (e) {
    console.error("[live]", e);
    return fail(500, "No hemos podido actualizar el libro.");
  }
}
