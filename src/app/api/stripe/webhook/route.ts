import { after, NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { cancelSubmission, publishSubmission, refreshSummaryIfNeeded } from "@/lib/book";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

async function publishIfPaid(session: Stripe.Checkout.Session): Promise<void> {
  const id = session.metadata?.submission_id || session.client_reference_id;
  if (!id || session.payment_status !== "paid") return;
  const { data: sub } = await db()
    .from("submissions")
    .select("id, amount_cents, provider_ref, status")
    .eq("id", id)
    .maybeSingle();
  if (!sub) {
    console.error("[stripe] pago sin envío asociado:", session.id);
    return;
  }
  if (sub.provider_ref !== session.id || session.amount_total !== sub.amount_cents) {
    console.error("[stripe] el pago no coincide con el envío", { session: session.id, sub: sub.id });
    return;
  }
  await publishSubmission(sub.id);
  after(() => refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e)));
}

// Avisos de Stripe: publica el párrafo cuando el pago se completa.
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature ?? "", env("STRIPE_WEBHOOK_SECRET"));
  } catch (e) {
    console.error("[stripe] firma no válida:", (e as Error).message);
    return NextResponse.json({ error: "firma no válida" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await publishIfPaid(event.data.object);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const id = event.data.object.metadata?.submission_id;
        if (id) await cancelSubmission(id);
        break;
      }
    }
  } catch (e) {
    console.error(`[stripe] error procesando ${event.type}:`, e);
    return NextResponse.json({ error: "reintentar" }, { status: 500 }); // Stripe lo reintentará
  }
  return NextResponse.json({ received: true });
}
