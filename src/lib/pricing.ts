// Precios en céntimos (IVA incluido). Este archivo lo usan el servidor y el navegador.
export const PRICES = { paragraph: 100, sign: 100, gold: 100 } as const;

export type InviteKind = "firma" | "oro";
export type LineKey = keyof typeof PRICES;

export interface QuoteLine {
  key: LineKey;
  label: string;
  cents: number;
  covered: boolean; // lo paga la invitación
}

export interface Quote {
  lines: QuoteLine[];
  gross: number;
  covered: number;
  total: number;
}

const LABELS: Record<LineKey, string> = {
  paragraph: "Párrafo en El Libro Infinito",
  sign: "Firma en el papiro",
  gold: "Párrafo en dorado",
};

// Una invitación cubre siempre el párrafo y la firma; el dorado solo si es de tipo 'oro'.
export function quote(opts: { signed: boolean; gold: boolean; invite: InviteKind | null }): Quote {
  const keys: LineKey[] = ["paragraph"];
  if (opts.signed) keys.push("sign");
  if (opts.gold) keys.push("gold");
  const lines = keys.map((key) => ({
    key,
    label: LABELS[key],
    cents: PRICES[key],
    covered: opts.invite !== null && (key !== "gold" || opts.invite === "oro"),
  }));
  const gross = lines.reduce((s, l) => s + l.cents, 0);
  const covered = lines.filter((l) => l.covered).reduce((s, l) => s + l.cents, 0);
  return { lines, gross, covered, total: gross - covered };
}

export function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
