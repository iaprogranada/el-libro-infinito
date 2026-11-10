import type { NextRequest } from "next/server";
import { paragraphsAfter, paragraphsBefore, paragraphsRange } from "@/lib/book";
import { cached, fail, int } from "@/lib/http";

export const runtime = "nodejs";

// ?before=N  → párrafos anteriores a N (no cambian nunca: caché larga)
// ?after=N   → párrafos posteriores a N
// ?from=A&to=B → un tramo concreto (para saltar a un párrafo)
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limit = int(p.get("limit"), 30, 1, 60);
  try {
    if (p.has("from") && p.has("to")) {
      const from = int(p.get("from"), 1, 1, Number.MAX_SAFE_INTEGER);
      const to = Math.min(int(p.get("to"), from, from, Number.MAX_SAFE_INTEGER), from + 80);
      const rows = await paragraphsRange(from, to);
      // Un tramo completo ya no cambia; uno que llega al final del libro puede crecer.
      const complete = rows.length > 0 && rows[rows.length - 1].n === to;
      return cached({ paragraphs: rows }, complete ? 3600 : 2);
    }
    if (p.has("before")) {
      const before = int(p.get("before"), 1, 1, Number.MAX_SAFE_INTEGER);
      return cached({ paragraphs: await paragraphsBefore(before, limit) }, 3600);
    }
    if (p.has("after")) {
      const after = int(p.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
      return cached({ paragraphs: await paragraphsAfter(after, limit) }, 2);
    }
    return fail(400, "Indica before, after o from y to.");
  } catch (e) {
    console.error("[paragraphs]", e);
    return fail(500, "No hemos podido cargar el libro.");
  }
}
