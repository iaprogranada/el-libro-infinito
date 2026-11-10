"use client";

import { useEffect, useRef, useState } from "react";
import { euros, quote, type InviteKind, type Quote } from "@/lib/pricing";
import { checkForm, LIMITS, normalizeInvite, normalizeText, normalizeUsername } from "@/lib/validation";
import SecurePay from "./SecurePay";

export interface Draft {
  username: string;
  text: string;
  signed: boolean;
  gold: boolean;
  invite: string;
}

const DRAFT_KEY = "libro:borrador";
const USER_KEY = "libro:usuario";

export function loadDraft(): Partial<Draft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    if (d.username) localStorage.setItem(USER_KEY, d.username);
  } catch {}
}
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}
function savedUser(): string {
  try {
    return localStorage.getItem(USER_KEY) ?? "";
  } catch {
    return "";
  }
}

const short = (cents: number) => (cents % 100 === 0 ? `${cents / 100} €` : euros(cents));

type Step = "form" | "checking" | "pay" | "redirecting";
type InviteState = { status: "empty" | "checking" | "bad" | "error" } | { status: "ok"; kind: InviteKind };
interface Payment {
  submissionId: string;
  quote: Quote;
  paypal: boolean;
  username: string;
  text: string;
  invite: string | null;
}

export default function WriteDialog({
  nextN,
  initial,
  onClose,
  onPublished,
}: {
  nextN: number;
  initial: Partial<Draft> | null;
  onClose: () => void;
  onPublished: (n: number) => void;
}) {
  const [username, setUsername] = useState(() => initial?.username || savedUser());
  const [text, setText] = useState(initial?.text ?? "");
  const [signed, setSigned] = useState(initial?.signed ?? false);
  const [gold, setGold] = useState(initial?.gold ?? false);
  const [invite, setInvite] = useState(initial?.invite ?? "");
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [inv, setInv] = useState<InviteState>({ status: "empty" });
  const [payment, setPayment] = useState<Payment | null>(null);
  const [payBusy, setPayBusy] = useState<"stripe" | "paypal" | null>(null);

  const userRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const cancelling = useRef<Promise<unknown>>(Promise.resolve());
  const lastKind = useRef<InviteKind | null>(null);

  const kind = inv.status === "ok" ? inv.kind : null;
  const price = quote({ signed, gold, invite: kind });
  const textLen = normalizeText(text).length;
  const busy = step === "checking" || step === "redirecting";

  // Al abrir: foco en el primer campo vacío.
  useEffect(() => {
    const t = setTimeout(() => (username ? textRef.current : userRef.current)?.focus(), 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda el borrador mientras se escribe, para no perderlo si se cierra la ventana.
  useEffect(() => {
    const t = setTimeout(() => saveDraft({ username, text, signed, gold, invite }), 400);
    return () => clearTimeout(t);
  }, [username, text, signed, gold, invite]);

  // Comprueba la invitación mientras se escribe.
  useEffect(() => {
    const code = normalizeInvite(invite);
    if (!code) {
      setInv({ status: "empty" });
      return;
    }
    setInv({ status: "checking" });
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/invite?code=${encodeURIComponent(code)}`, { signal: ctrl.signal });
        const j = (await r.json()) as { valid?: boolean; kind?: InviteKind };
        if (!r.ok) setInv({ status: "error" });
        else setInv(j.valid && j.kind ? { status: "ok", kind: j.kind } : { status: "bad" });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setInv({ status: "error" });
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [invite]);

  // Una invitación válida marca sola los extras que incluye.
  useEffect(() => {
    if (kind && kind !== lastKind.current) {
      setSigned(true);
      if (kind === "oro") setGold(true);
    }
    lastKind.current = kind;
  }, [kind]);

  useEffect(() => {
    if (err) errRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [err]);

  function cancelPending() {
    if (!payment) return;
    const id = payment.submissionId;
    cancelling.current = fetch(`/api/submission?id=${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
    setPayment(null);
  }

  function close() {
    if (busy) return;
    if (step === "pay") cancelPending();
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const u = normalizeUsername(username);
    const t = normalizeText(text);
    const formError = checkForm(u, t);
    if (formError) return setErr(formError);
    if (!terms) return setErr("Para publicar tienes que aceptar los términos de uso.");
    if (inv.status === "bad") {
      return setErr("El código de invitación no es válido o ya se ha usado. Corrígelo o déjalo en blanco para pagar.");
    }
    const code = normalizeInvite(invite);
    setStep("checking");
    await cancelling.current;
    try {
      const r = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, text: t, signed, gold, invite: code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStep("form");
        setErr(j.error ?? "Algo ha fallado. Inténtalo de nuevo.");
        return;
      }
      if (j.status === "published") {
        clearDraft();
        onPublished(Number(j.n));
        return;
      }
      setPayment({ submissionId: j.submissionId, quote: j.quote, paypal: Boolean(j.paypal), username: u, text: t, invite: code });
      setStep("pay");
    } catch {
      setStep("form");
      setErr("No hemos podido conectar. Revisa tu conexión y vuelve a intentarlo.");
    }
  }

  async function pay(method: "stripe" | "paypal") {
    if (!payment) return;
    setErr(null);
    setPayBusy(method);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: payment.submissionId, method }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) {
        setPayBusy(null);
        setErr(j.error ?? "No hemos podido abrir el pago. Inténtalo de nuevo.");
        return;
      }
      setStep("redirecting");
      window.location.assign(j.url);
    } catch {
      setPayBusy(null);
      setErr("No hemos podido conectar. Revisa tu conexión y vuelve a intentarlo.");
    }
  }

  const inviteMsg =
    inv.status === "ok"
      ? inv.kind === "oro"
        ? { cls: "ok", text: "Invitación válida: párrafo, firma y dorado gratis." }
        : { cls: "ok", text: "Invitación válida: párrafo y firma gratis. El dorado, si lo quieres, es +1 €." }
      : inv.status === "bad"
        ? { cls: "bad", text: "Ese código no es válido o ya se ha usado." }
        : inv.status === "checking"
          ? { cls: "", text: "Comprobando el código…" }
          : inv.status === "error"
            ? { cls: "bad", text: "No hemos podido comprobar el código. Lo revisaremos al enviar." }
            : { cls: "", text: "Si alguien te ha invitado, tu párrafo puede salirte gratis." };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="writeTitle"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="sheet">
        <button type="button" className="x" onClick={close} aria-label="Cerrar" disabled={busy}>
          ×
        </button>

        {step === "form" && (
          <form onSubmit={submit} noValidate>
            <h2 id="writeTitle">Escribe el párrafo {nextN}</h2>
            <p className="lead">
              Lee cómo va la historia y continúala como quieras: síguela, dale un giro o intenta arreglarla. Una vez publicado, tu
              párrafo se queda en el libro para siempre.
            </p>
            {err && (
              <div className="err" ref={errRef} role="alert">
                {err}
              </div>
            )}
            <div className="field">
              <label htmlFor="username">Tu nombre de usuario</label>
              <input
                ref={userRef}
                type="text"
                id="username"
                maxLength={LIMITS.userMax}
                placeholder="Tu nombre, o «banana loca»…"
                autoComplete="nickname"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <div className="hint">
                <span>Aparecerá en la lista de autores.</span>
                <span>
                  {username.length}/{LIMITS.userMax}
                </span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="text">Tu párrafo</label>
              <textarea ref={textRef} id="text" placeholder="Y entonces…" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="hint">
                <span>Puede ser una sola frase.</span>
                <span className={textLen > LIMITS.textMax ? "over" : undefined}>
                  {textLen}/{LIMITS.textMax}
                </span>
              </div>
            </div>
            <fieldset className="extras">
              <legend>Extras opcionales</legend>
              <label className="check extra">
                <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
                <span>
                  <b>Firma tu párrafo · +1 €</b> Tu nombre aparecerá escrito al final de tu párrafo, en el papiro. Si no firmas, solo
                  saldrá en la lista de autores.
                </span>
              </label>
              <label className="check extra goldopt">
                <input type="checkbox" checked={gold} onChange={(e) => setGold(e.target.checked)} />
                <span>
                  <b>Párrafo en dorado · +1 €</b> Tu párrafo brillará en dorado dentro del papiro, para siempre.
                </span>
              </label>
            </fieldset>
            <div className="field">
              <label htmlFor="invite" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14 }}>
                ¿Tienes un código de invitación? Insértalo aquí
              </label>
              <input
                type="text"
                id="invite"
                className="code"
                maxLength={24}
                placeholder="Tu código"
                autoComplete="off"
                spellCheck={false}
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
              <div className="hint">
                <span className={inviteMsg.cls || undefined}>{inviteMsg.text}</span>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                Acepto los{" "}
                <a href="/terminos" target="_blank" rel="noopener">
                  términos de uso
                </a>{" "}
                y entiendo que lo que escribo es responsabilidad mía y que, al publicarse, no se puede borrar ni devolver.
              </span>
            </label>
            <div className="row">
              <button type="button" className="ghost" onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="ink-btn">
                {price.total === 0 ? "Revisar y publicar gratis" : `Revisar y pagar ${short(price.total)}`}
              </button>
            </div>
          </form>
        )}

        {busy && (
          <div className="wait" role="status">
            <span className="quill" aria-hidden="true" />
            <span>{step === "checking" ? "Comprobando que cumple las normas…" : "Abriendo el pago seguro…"}</span>
          </div>
        )}

        {step === "pay" && payment && (
          <div>
            <h2 id="writeTitle">Tu párrafo está listo</h2>
            <p className="lead">Ha pasado el filtro. Solo falta el pago para publicarlo.</p>
            {err && (
              <div className="err" ref={errRef} role="alert">
                {err}
              </div>
            )}
            <div className="pay">
              {payment.quote.lines.map((l) => (
                <div className="line" key={l.key}>
                  <span>{l.key === "sign" ? `Firma en el papiro: ${payment.username}` : l.label}</span>
                  <span>{euros(l.cents)}</span>
                </div>
              ))}
              {payment.quote.covered > 0 && (
                <div className="line">
                  <span>
                    Invitación <b>{payment.invite}</b>
                  </span>
                  <span>−{euros(payment.quote.covered)}</span>
                </div>
              )}
              <div className="line total">
                <span>Total (IVA incluido)</span>
                <span>{euros(payment.quote.total)}</span>
              </div>
              <blockquote>{payment.text}</blockquote>
            </div>
            <div className="pay-buttons">
              <button type="button" className="pay-btn card" onClick={() => pay("stripe")} disabled={payBusy !== null}>
                Pagar {short(payment.quote.total)} con tarjeta <small>· Apple Pay · Google Pay</small>
              </button>
              {payment.paypal && (
                <button type="button" className="pay-btn paypal" onClick={() => pay("paypal")} disabled={payBusy !== null}>
                  Pagar con PayPal
                </button>
              )}
            </div>
            <SecurePay paypal={payment.paypal} />
            <p className="secure">Tu párrafo se publica en cuanto se confirma el pago.</p>
            <div className="row split">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  cancelPending();
                  setErr(null);
                  setStep("form");
                }}
              >
                Volver a editar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
