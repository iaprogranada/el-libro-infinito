import { NextResponse, type NextRequest } from "next/server";
import { previewHouseParagraph, runHouseWriter, todayPlan } from "@/lib/house";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Comprobaciones internas (ver el plan de hoy o un párrafo de prueba sin publicarlo). No es una clave de nada:
// solo evita que un curioso que encuentre la ruta vea cómo funciona.
const CHECK = "3140f1f78a2d4872eb2bf34d";

// Lo llama cada dos horas la tarea programada de GitHub (.github/workflows/casa.yml) y, de paso, las visitas.
// Es seguro llamarlo de más: nunca publica fuera del plan del día.
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const check = req.nextUrl.searchParams.get("check") === CHECK;
  try {
    if (check && req.nextUrl.searchParams.has("preview")) {
      return NextResponse.json({ plan: todayPlan(), preview: await previewHouseParagraph() }, { headers });
    }
    const result = await runHouseWriter();
    return NextResponse.json(check ? { plan: todayPlan(), result } : { ok: true }, { headers });
  } catch (e) {
    console.error("[casa]", e);
    return NextResponse.json({ ok: false }, { status: 500, headers });
  }
}
