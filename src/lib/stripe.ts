import "server-only";
import Stripe from "stripe";
import { env, siteUrl } from "./env";
import type { QuoteLine } from "./pricing";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!client) client = new Stripe(env("STRIPE_SECRET_KEY"));
  return client;
}

// Crea el pago en Stripe Checkout (tarjeta, Apple Pay, Google Pay…) y devuelve la URL de pago.
export async function createStripeCheckout(submissionId: string, lines: QuoteLine[]): Promise<{ id: string; url: string }> {
  const payable = lines.filter((l) => !l.covered);
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      locale: "es",
      client_reference_id: submissionId,
      metadata: { submission_id: submissionId },
      payment_intent_data: { metadata: { submission_id: submissionId }, description: "El Libro Infinito" },
      line_items: payable.map((l) => ({
        quantity: 1,
        price_data: { currency: "eur", unit_amount: l.cents, product_data: { name: l.label } },
      })),
      success_url: `${siteUrl()}/?pago=ok&envio=${submissionId}`,
      cancel_url: `${siteUrl()}/?pago=cancelado&envio=${submissionId}`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    },
    { idempotencyKey: `checkout-${submissionId}` },
  );
  if (!session.url) throw new Error("Stripe no devolvió URL de pago");
  return { id: session.id, url: session.url };
}
