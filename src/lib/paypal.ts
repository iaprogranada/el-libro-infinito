import "server-only";
import { env, siteUrl } from "./env";
import type { QuoteLine } from "./pricing";

function base(): string {
  return process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function accessToken(): Promise<string> {
  const auth = Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

const eur = (cents: number) => (cents / 100).toFixed(2);

// Crea un pedido de PayPal y devuelve la URL donde el usuario aprueba el pago.
export async function createPayPalOrder(submissionId: string, lines: QuoteLine[]): Promise<{ id: string; url: string }> {
  const payable = lines.filter((l) => !l.covered);
  const total = payable.reduce((s, l) => s + l.cents, 0);
  const token = await accessToken();
  const res = await fetch(`${base()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `order-${submissionId}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: submissionId,
          description: "El Libro Infinito",
          amount: {
            currency_code: "EUR",
            value: eur(total),
            breakdown: { item_total: { currency_code: "EUR", value: eur(total) } },
          },
          items: payable.map((l) => ({
            name: l.label,
            quantity: "1",
            category: "DIGITAL_GOODS",
            unit_amount: { currency_code: "EUR", value: eur(l.cents) },
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "El Libro Infinito",
            locale: "es-ES",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${siteUrl()}/api/paypal/return?envio=${submissionId}`,
            cancel_url: `${siteUrl()}/?pago=cancelado&envio=${submissionId}`,
          },
        },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal crear pedido ${res.status}: ${await res.text()}`);
  const order = (await res.json()) as { id: string; links: { rel: string; href: string }[] };
  const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approve) throw new Error("PayPal no devolvió enlace de aprobación");
  return { id: order.id, url: approve.href };
}

interface CaptureResult {
  completed: boolean;
  amountCents: number;
  customId: string | null;
}

function readCapture(order: {
  status?: string;
  purchase_units?: { custom_id?: string; payments?: { captures?: { status: string; amount: { value: string } }[] } }[];
}): CaptureResult {
  const unit = order.purchase_units?.[0];
  const cap = unit?.payments?.captures?.find((c) => c.status === "COMPLETED");
  return {
    completed: order.status === "COMPLETED" && Boolean(cap),
    amountCents: cap ? Math.round(Number(cap.amount.value) * 100) : 0,
    customId: unit?.custom_id ?? null,
  };
}

// Cobra un pedido aprobado. Si ya estaba cobrado, devuelve su estado.
export async function capturePayPalOrder(orderId: string): Promise<CaptureResult> {
  const token = await accessToken();
  const res = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `capture-${orderId}` },
    cache: "no-store",
  });
  if (res.ok) return readCapture(await res.json());
  if (res.status === 422) {
    const again = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (again.ok) return readCapture(await again.json());
  }
  throw new Error(`PayPal cobrar ${res.status}: ${await res.text()}`);
}

// Estado de un pedido sin cobrarlo (para recuperar un cobro que no llegó a publicarse).
export async function getPayPalOrder(orderId: string): Promise<CaptureResult> {
  const token = await accessToken();
  const res = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal consultar ${res.status}: ${await res.text()}`);
  return readCapture(await res.json());
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}
