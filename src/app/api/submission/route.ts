import { after, NextResponse, type NextRequest } from "next/server";
import { cancelSubmission, publishSubmission, refreshSummaryIfNeeded } from "@/lib/book";
import { fail, UUID_RE } from "@/lib/http";
import { getPayPalOrder } from "@/lib/paypal";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

interface Sub {
  id: string;
  status: string;
  published_n: number | null;
  provider: string | null;
  provider_ref: string | null;
  amount_cents: number;
}

async function load(id: string): Promise<Sub | null> {
  const { data } = await db()
    .from("submissions")
    .select("id, status, published_n, provider, provider_ref, amount_cents")
    .eq("id", id)
    .maybeSingle();
  return (data as Sub | null) ?? null;
}

// Si el pago ya está hecho pero el aviso no ha llegado, lo comprobamos con el proveedor y publicamos.
async function publishIfAlreadyPaid(sub: Sub): Promise<number | null> {
  if (sub.status !== "pending" || !sub.provider_ref) return null;
  let paid = false;
  try {
    if (sub.provider === "stripe") {
      const session = await stripe().checkout.sessions.retrieve(sub.provider_ref);
      paid = session.payment_status === "paid" && session.amount_total === sub.amount_cents;
    } else if (sub.provider === "paypal") {
      const order = await getPayPalOrder(sub.provider_ref);
      paid = order.completed && order.amountCents === sub.amount_cents && order.customId === sub.id;
    }
  } catch (e) {
    console.error(`[submission] error consultando ${sub.provider}:`, e);
    return null;
  }
  if (!paid) return null;
  const n = await publishSubmission(sub.id);
  after(() => refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e)));
  return n;
}

// Estado de un envío tras volver del pago.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return fail(400, "Envío no válido.");
  const sub = await load(id);
  if (!sub) return fail(404, "No encontramos ese envío.");

  const n = (await publishIfAlreadyPaid(sub)) ?? sub.published_n;
  const status = n ? "published" : sub.status;
  return NextResponse.json({ status, n }, { headers: { "Cache-Control": "no-store" } });
}

// Anula un envío que no se va a pagar (vuelta atrás o pago cancelado) y libera su invitación.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return fail(400, "Envío no válido.");
  const sub = await load(id);
  if (!sub) return fail(404, "No encontramos ese envío.");
  if (sub.status !== "pending") return NextResponse.json({ status: sub.status, n: sub.published_n });

  // Cerramos el pago de Stripe para que no se pueda completar después; si ya estaba pagado, se publica.
  if (sub.provider === "stripe" && sub.provider_ref) {
    try {
      await stripe().checkout.sessions.expire(sub.provider_ref);
    } catch {
      const n = await publishIfAlreadyPaid(sub);
      if (n) return NextResponse.json({ status: "published", n });
    }
  }
  if (sub.provider === "paypal") {
    const n = await publishIfAlreadyPaid(sub);
    if (n) return NextResponse.json({ status: "published", n });
  }
  await cancelSubmission(sub.id);
  return NextResponse.json({ status: "cancelled", n: null }, { headers: { "Cache-Control": "no-store" } });
}
