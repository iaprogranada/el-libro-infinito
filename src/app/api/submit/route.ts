import { after, NextResponse, type NextRequest } from "next/server";
import { moderate } from "@/lib/ai";
import { cancelSubmission, publishSubmission, rateAllowed, refreshSummaryIfNeeded } from "@/lib/book";
import { clientIp, fail } from "@/lib/http";
import { peekInvite, reserveInvite } from "@/lib/invites";
import { paypalConfigured } from "@/lib/paypal";
import { quote, type InviteKind } from "@/lib/pricing";
import { db } from "@/lib/supabase";
import { checkForm, normalizeInvite, normalizeText, normalizeUsername, quickReject } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOT_CHARGED = "No se te ha cobrado nada.";

// Paso 1: revisa el párrafo con el filtro y lo deja listo para pagar (o lo publica si la invitación lo cubre todo).
export async function POST(req: NextRequest) {
  let body: { username?: unknown; text?: unknown; signed?: unknown; gold?: unknown; invite?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "No hemos podido leer tu envío. Recarga la página y vuelve a intentarlo.");
  }

  const username = normalizeUsername(String(body.username ?? ""));
  const text = normalizeText(String(body.text ?? ""));
  const signed = body.signed === true;
  const gold = body.gold === true;
  const code = normalizeInvite(typeof body.invite === "string" ? body.invite : null);

  const formError = checkForm(username, text);
  if (formError) return fail(400, formError);

  if (!(await rateAllowed("submit", clientIp(req), 8, 600))) {
    return fail(429, "Has hecho muchos intentos seguidos. Espera unos minutos y vuelve a probar.");
  }

  const quick = quickReject(username, text);
  if (quick) return fail(422, `No podemos publicar tu párrafo porque ${quick}. Cámbialo y vuelve a intentarlo; ${NOT_CHARGED.toLowerCase()}`);

  let kind: InviteKind | null = null;
  if (code) {
    kind = await peekInvite(code);
    if (!kind) return fail(422, "El código de invitación no es válido o ya se ha usado. Corrígelo o déjalo en blanco para pagar.");
  }

  const verdict = await moderate(username, text);
  if (!verdict.ok) {
    if ("unavailable" in verdict) return fail(503, "Ahora mismo no podemos revisar tu párrafo. Inténtalo de nuevo en un minuto.");
    return fail(422, `${verdict.reason} ${NOT_CHARGED}`);
  }

  const q = quote({ signed, gold, invite: kind });
  const { data: sub, error } = await db()
    .from("submissions")
    .insert({
      username,
      body: text,
      signed,
      gold,
      amount_cents: q.total,
      invite_code: code,
      provider: q.total === 0 ? "invite" : null,
    })
    .select("id")
    .single();
  if (error || !sub) {
    console.error("[submit] no se pudo guardar el envío:", error?.message);
    return fail(500, "No hemos podido guardar tu párrafo. Inténtalo de nuevo.");
  }

  if (code) {
    const reserved = await reserveInvite(code, sub.id);
    if (reserved !== kind) {
      await cancelSubmission(sub.id);
      return fail(409, "Esa invitación se acaba de usar. Déjala en blanco para pagar con tarjeta o PayPal.");
    }
  }

  if (q.total === 0) {
    const n = await publishSubmission(sub.id);
    after(() => refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e)));
    return NextResponse.json({ status: "published", n }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { status: "payment", submissionId: sub.id, quote: q, paypal: paypalConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
