import { after, NextResponse, type NextRequest } from "next/server";
import { publishSubmission, refreshSummaryIfNeeded } from "@/lib/book";
import { siteUrl } from "@/lib/env";
import { UUID_RE } from "@/lib/http";
import { capturePayPalOrder } from "@/lib/paypal";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// PayPal devuelve aquí al usuario tras aprobar el pago: cobramos y publicamos.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("envio") ?? "";
  const orderId = req.nextUrl.searchParams.get("token") ?? "";
  const back = (estado: string) => NextResponse.redirect(`${siteUrl()}/?pago=${estado}&envio=${encodeURIComponent(id)}`, 303);
  if (!UUID_RE.test(id) || !orderId) return back("error");

  const { data: sub } = await db()
    .from("submissions")
    .select("id, amount_cents, provider_ref, status")
    .eq("id", id)
    .maybeSingle();
  if (!sub || sub.provider_ref !== orderId) return back("error");
  if (sub.status === "published") return back("ok");

  try {
    const capture = await capturePayPalOrder(orderId);
    if (!capture.completed || capture.amountCents !== sub.amount_cents || capture.customId !== sub.id) {
      console.error("[paypal] el cobro no coincide", { id, orderId, capture });
      return back("error");
    }
    await publishSubmission(sub.id);
    after(() => refreshSummaryIfNeeded().catch((e) => console.error("[resumen]", e)));
    return back("ok");
  } catch (e) {
    console.error("[paypal] error al cobrar:", e);
    return back("error");
  }
}
