// Reglas de forma (no de contenido). Las usan el servidor y el navegador.
export const LIMITS = { textMax: 500, userMin: 2, userMax: 24 } as const;

export function normalizeUsername(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2060-\u206F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeInvite(raw: string | null | undefined): string | null {
  const c = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  return c ? c : null;
}

// Devuelve un mensaje de error en español, o null si todo está bien.
export function checkForm(username: string, text: string): string | null {
  if (username.length < LIMITS.userMin) return `Escribe un nombre de usuario de al menos ${LIMITS.userMin} caracteres.`;
  if (username.length > LIMITS.userMax) return `El nombre de usuario puede tener como mucho ${LIMITS.userMax} caracteres.`;
  if (!/^[\p{L}\p{N} _.\-'’]+$/u.test(username)) return "El nombre de usuario solo puede tener letras, números, espacios y los signos _ . - '";
  if (!text) return "Escribe tu párrafo. Basta con una frase.";
  if (text.length > LIMITS.textMax) return `Tu párrafo tiene ${text.length} caracteres. El máximo es ${LIMITS.textMax}.`;
  return null;
}

// Filtro rápido y gratuito antes de preguntar a la IA.
const BANNED = [
  "idiota", "imbecil", "gilipollas", "subnormal", "mierda", "joder", "puta", "puto", "putas", "putos",
  "cabron", "cabrona", "capullo", "zorra", "maricon", "retrasado", "gilipuertas", "hijoputa",
  "pendejo", "cojones", "follar",
];
const THREATS = [
  /\b(te|os|les?|la|lo) voy a (matar|reventar|partir la cara|pegar)/,
  /\bvoy a matar(te|os|le|la|lo)?\b/,
  /\bmuerete\b/,
  /\b(te|os) mato\b/,
];

function plain(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function quickReject(username: string, text: string): string | null {
  const s = plain(username + " \n " + text);
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|es|net|org|io|me|ly|gg|tv|app|link|xyz|shop)\b|@[a-z0-9_]{3,}|\bt\.me\/)/.test(s)) {
    return "contiene enlaces, menciones o publicidad";
  }
  if (THREATS.some((r) => r.test(s))) return "parece una amenaza";
  const words = new Set(s.split(/[^a-z0-9ñ]+/));
  const bannedPlain = BANNED.map(plain);
  if (bannedPlain.some((w) => words.has(w))) return "contiene insultos o palabras malsonantes";
  return null;
}
