import { NextResponse } from "next/server";
import { catchUpHouseWriter } from "@/lib/house";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Lo llama el cron diario de Vercel (vercel.json) entre las 22:00 y las 23:00 de Madrid en invierno.
// Es seguro llamarlo de más: nunca publica fuera del plan del día.
export async function GET() {
  try {
    await catchUpHouseWriter();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[casa] repaso", e);
    return NextResponse.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
