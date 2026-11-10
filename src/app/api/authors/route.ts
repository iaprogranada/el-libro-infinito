import type { NextRequest } from "next/server";
import { authorsBefore, searchAuthors } from "@/lib/book";
import { cached, fail, int } from "@/lib/http";

export const runtime = "nodejs";

// ?before=N → autores (por orden de párrafo) anteriores a N · ?q=texto → búsqueda por nombre
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const q = (p.get("q") ?? "").trim().slice(0, 24);
    if (q) {
      if (q.length < 2) return cached({ authors: [] }, 30);
      return cached({ authors: await searchAuthors(q) }, 20);
    }
    const before = int(p.get("before"), 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = int(p.get("limit"), 300, 1, 500);
    return cached({ authors: await authorsBefore(before, limit) }, 3600);
  } catch (e) {
    console.error("[authors]", e);
    return fail(500, "No hemos podido cargar los autores.");
  }
}
