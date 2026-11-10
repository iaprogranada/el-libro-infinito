import { NextResponse, type NextRequest } from "next/server";
import { rateAllowed } from "@/lib/book";
import { clientIp, fail } from "@/lib/http";
import { peekInvite } from "@/lib/invites";
import { normalizeInvite } from "@/lib/validation";

export const runtime = "nodejs";

// Comprueba en vivo un código de invitación mientras se escribe en el formulario.
export async function GET(req: NextRequest) {
  const code = normalizeInvite(req.nextUrl.searchParams.get("code"));
  if (!code || code.length > 24) return NextResponse.json({ valid: false, kind: null }, { headers: { "Cache-Control": "no-store" } });
  if (!(await rateAllowed("invite", clientIp(req), 40, 600))) {
    return fail(429, "Demasiados intentos. Espera unos minutos.");
  }
  try {
    const kind = await peekInvite(code);
    return NextResponse.json({ valid: kind !== null, kind }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[invite]", e);
    return fail(500, "No hemos podido comprobar el código.");
  }
}
