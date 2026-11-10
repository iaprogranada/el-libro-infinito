import "server-only";
import { db } from "./supabase";
import type { InviteKind } from "./pricing";

// Tipo de la invitación si se puede usar ahora mismo; null si no existe, está gastada o reservada.
export async function peekInvite(code: string): Promise<InviteKind | null> {
  const { data, error } = await db()
    .from("invites")
    .select("kind, used_at, reserved_by, reserved_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.used_at) return null;
  if (data.reserved_by && data.reserved_at && Date.now() - new Date(data.reserved_at).getTime() < 45 * 60_000) return null;
  return data.kind as InviteKind;
}

export async function inviteKind(code: string): Promise<InviteKind | null> {
  const { data, error } = await db().from("invites").select("kind").eq("code", code).maybeSingle();
  if (error) throw error;
  return (data?.kind as InviteKind) ?? null;
}

export async function reserveInvite(code: string, submissionId: string): Promise<InviteKind | null> {
  const { data, error } = await db().rpc("reserve_invite", { p_code: code, p_submission: submissionId });
  if (error) throw error;
  return (data as InviteKind | null) ?? null;
}
