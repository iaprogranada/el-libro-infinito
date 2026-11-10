import { NextResponse, type NextRequest } from "next/server";
import { fail, UUID_RE } from "@/lib/http";
import { inviteKind } from "@/lib/invites";
import { createPayPalOrder, paypalConfigured } from "@/lib/paypal";
import { quote } from "@/lib/pricing";
import { createStripeCheckout } from "@/lib/stripe";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// Paso 2: crea el pago (Stripe o PayPal) para un envío que ya pasó el filtro.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { submissionId?: string; method?: string };
  const id = String(body.submissionId ?? "");
  const method = body.method === "paypal" ? "paypal" : "stripe";
  if (!UUID_RE.test(id)) return fail(400, "Falta el envío.");

  const { data: sub, error } = await db()
    .from("submissions")
    .select("id, signed, gold, amount_cents, invite_code, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(500, "No hemos podido preparar el pago. Inténtalo de nuevo.");
  if (!sub || sub.status !== "pending") return fail(409, "Este párrafo ya no está pendiente de pago. Vuelve a escribirlo.");
  if (Date.now() - new Date(sub.created_at).getTime() > 40 * 60_000) {
    return fail(410, "Ha pasado demasiado tiempo desde que escribiste el párrafo. Vuelve a enviarlo.");
  }

  const kind = sub.invite_code ? await inviteKind(sub.invite_code) : null;
  const q = quote({ signed: sub.signed, gold: sub.gold, invite: kind });
  if (q.total !== sub.amount_cents || q.total <= 0) return fail(409, "El importe no cuadra. Vuelve a escribir tu párrafo.");

  try {
    if (method === "paypal") {
      if (!paypalConfigured()) return fail(400, "El pago con PayPal aún no está disponible. Paga con tarjeta.");
      const order = await createPayPalOrder(sub.id, q.lines);
      await db().from("submissions").update({ provider: "paypal", provider_ref: order.id }).eq("id", sub.id);
      return NextResponse.json({ url: order.url }, { headers: { "Cache-Control": "no-store" } });
    }
    const session = await createStripeCheckout(sub.id, q.lines);
    await db().from("submissions").update({ provider: "stripe", provider_ref: session.id }).eq("id", sub.id);
    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`[checkout] error creando el pago con ${method}:`, e);
    return fail(502, "No hemos podido abrir el pago. Inténtalo de nuevo en un momento.");
  }
}
