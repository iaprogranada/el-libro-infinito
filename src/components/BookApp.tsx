"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AuthorEntry, Paragraph, Stats, Summary } from "@/lib/book";
import { longDate } from "@/lib/site";
import Footer from "./Footer";
import SecurePay from "./SecurePay";
import WriteDialog, { clearDraft, loadDraft, type Draft } from "./WriteDialog";

export interface InitialData {
  ok: boolean;
  stats: Stats;
  paragraphs: Paragraph[];
  authors: AuthorEntry[];
  summary: Summary | null;
}

interface LiveResponse {
  stats: Stats;
  summary: Summary | null;
  paragraphs: Paragraph[];
}

type Mark = { n: number | null; user: string | null; query: string | null };
type Load = "idle" | "loading" | "error";
type Returning = { phase: "waiting" | "slow" | "failed" } | null;

const NO_MARK: Mark = { n: null, user: null, query: null };
const PAGE = 30;
const AUTHORS_PAGE = 300;
const POLL_MS = 12_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmt = (n: number) => n.toLocaleString("es-ES");
const lower = (s: string) => s.toLocaleLowerCase("es-ES");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const toAuthor = (p: Paragraph): AuthorEntry => ({ n: p.n, username: p.username, gold: p.gold });

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

// Añade al final solo lo que sigue sin huecos a lo que ya hay.
function appendContiguous<T extends { n: number }>(cur: T[], incoming: T[]): T[] {
  let last = cur.length ? cur[cur.length - 1].n : null;
  const add: T[] = [];
  for (const p of incoming) {
    if (last === null || p.n === last + 1) {
      add.push(p);
      last = p.n;
    } else if (p.n > last + 1) break;
  }
  return add.length ? [...cur, ...add] : cur;
}

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return "el " + longDate(iso).replace(/ de \d{4}$/, "");
}

const Par = memo(function Par({ p, hl, soft }: { p: Paragraph; hl: boolean; soft: boolean }) {
  const cls = "par" + (p.n === 1 ? " first" : "") + (p.gold ? " gold" : "") + (hl ? " hl" : soft ? " soft" : "");
  return (
    <p className={cls} id={`p-${p.n}`}>
      <span className="num" aria-hidden="true">
        {p.n}
      </span>
      <span className="sr-only">Párrafo {p.n}. </span>
      {p.body}{" "}
      {p.signed && <span className="by">— {p.username}</span>}
    </p>
  );
});

export default function BookApp({ initial }: { initial: InitialData }) {
  const [stats, setStats] = useState(initial.stats);
  const [items, setItems] = useState(initial.paragraphs);
  const [authors, setAuthors] = useState(initial.authors);
  const [summary, setSummary] = useState(initial.summary);
  const [latest, setLatest] = useState<Paragraph | null>(initial.paragraphs.at(-1) ?? null);
  const [older, setOlder] = useState<Load>("idle");
  const [newer, setNewer] = useState<Load>("idle");
  const [authorsLoad, setAuthorsLoad] = useState<Load>("idle");
  const [bookLoad, setBookLoad] = useState<Load>(initial.ok ? "idle" : "loading");
  const [mark, setMark] = useState<Mark>(NO_MARK);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthorEntry[] | null>(null);
  const [drawer, setDrawer] = useState<"authors" | "summary" | null>(null);
  const [write, setWrite] = useState<{ open: boolean; draft: Partial<Draft> | null; key: number }>({ open: false, draft: null, key: 0 });
  const [freshN, setFreshN] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [returning, setReturning] = useState<Returning>(null);
  const [now, setNow] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const parchRef = useRef<HTMLDivElement>(null);
  const authorsRef = useRef<HTMLOListElement>(null);
  const itemsRef = useRef(items);
  const authorsListRef = useRef(authors);
  const statsRef = useRef(stats);
  itemsRef.current = items;
  authorsListRef.current = authors;
  statsRef.current = stats;
  const busy = useRef({ older: false, newer: false, authors: false, live: false });
  const parAnchor = useRef<{ h: number; top: number } | null>(null);
  const authAnchor = useRef<{ h: number; top: number } | null>(null);
  const pendingScroll = useRef<{ n: number; flash: boolean } | null>(null);
  const stickBottom = useRef<"instant" | "smooth" | null>("instant");
  const authorsToBottom = useRef(true);
  const quietUntil = useRef(0);

  const lastN = Math.max(stats.lastN, items.at(-1)?.n ?? 0, authors.at(-1)?.n ?? 0);
  const nextN = lastN + 1;
  const first = items[0];
  const atEnd = items.length === 0 || (items.at(-1)?.n ?? 0) >= lastN;
  const knownLast = () =>
    Math.max(statsRef.current.lastN, itemsRef.current.at(-1)?.n ?? 0, authorsListRef.current.at(-1)?.n ?? 0);

  /* ---------------- Scroll: mantener la posición, bajar al final, saltar a un párrafo ---------------- */

  useLayoutEffect(() => {
    const el = parchRef.current;
    if (el) {
      if (parAnchor.current) {
        el.scrollTop = parAnchor.current.top + (el.scrollHeight - parAnchor.current.h);
        parAnchor.current = null;
      }
      if (stickBottom.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: stickBottom.current === "smooth" && !reduced() ? "smooth" : "auto" });
        stickBottom.current = null;
      }
      const target = pendingScroll.current;
      const p = target ? document.getElementById(`p-${target.n}`) : null;
      if (target && p) {
        pendingScroll.current = null;
        quietUntil.current = Date.now() + 1200;
        const top = p.offsetTop - el.clientHeight / 2 + p.offsetHeight / 2;
        el.scrollTo({ top: Math.max(0, top), behavior: reduced() ? "auto" : "smooth" });
        if (target.flash) {
          p.classList.remove("flash");
          void p.offsetWidth;
          p.classList.add("flash");
        }
      }
    }
    const al = authorsRef.current;
    if (al) {
      if (authAnchor.current) {
        al.scrollTop = authAnchor.current.top + (al.scrollHeight - authAnchor.current.h);
        authAnchor.current = null;
      }
      if (authorsToBottom.current) {
        al.scrollTop = al.scrollHeight;
        authorsToBottom.current = false;
      }
    }
  });

  /* ---------------- Carga de páginas ---------------- */

  const loadOlder = useCallback(async () => {
    const head = itemsRef.current[0];
    if (!head || head.n <= 1 || busy.current.older) return;
    busy.current.older = true;
    setOlder("loading");
    try {
      const { paragraphs } = await getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?before=${head.n}&limit=${PAGE}`);
      if (itemsRef.current[0]?.n === head.n && paragraphs.length) {
        const el = parchRef.current;
        if (el) parAnchor.current = { h: el.scrollHeight, top: el.scrollTop };
        setItems((cur) => [...paragraphs.filter((p) => p.n < head.n), ...cur]);
      }
      setOlder("idle");
    } catch {
      setOlder("error");
    } finally {
      busy.current.older = false;
    }
  }, []);

  const loadNewer = useCallback(async () => {
    const tail = itemsRef.current.at(-1);
    if (!tail || tail.n >= knownLast() || busy.current.newer) return;
    busy.current.newer = true;
    setNewer("loading");
    try {
      const { paragraphs } = await getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?after=${tail.n}&limit=${PAGE}`);
      if (itemsRef.current.at(-1)?.n === tail.n) setItems((cur) => appendContiguous(cur, paragraphs));
      setNewer("idle");
    } catch {
      setNewer("error");
    } finally {
      busy.current.newer = false;
    }
  }, []);

  const onParchScroll = useCallback(() => {
    const el = parchRef.current;
    if (!el || Date.now() < quietUntil.current) return;
    if (el.scrollTop < 500) loadOlder();
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) loadNewer();
  }, [loadOlder, loadNewer]);

  const loadOlderAuthors = useCallback(async () => {
    const head = authorsListRef.current[0];
    if (!head || head.n <= 1 || busy.current.authors) return;
    busy.current.authors = true;
    setAuthorsLoad("loading");
    try {
      const { authors: older } = await getJSON<{ authors: AuthorEntry[] }>(`/api/authors?before=${head.n}&limit=${AUTHORS_PAGE}`);
      if (authorsListRef.current[0]?.n === head.n && older.length) {
        const al = authorsRef.current;
        if (al) authAnchor.current = { h: al.scrollHeight, top: al.scrollTop };
        setAuthors((cur) => [...older.filter((a) => a.n < head.n), ...cur]);
      }
      setAuthorsLoad("idle");
    } catch {
      setAuthorsLoad("error");
    } finally {
      busy.current.authors = false;
    }
  }, []);

  const onAuthorsScroll = useCallback(() => {
    const al = authorsRef.current;
    if (al && al.scrollTop < 300) loadOlderAuthors();
  }, [loadOlderAuthors]);

  /* ---------------- Lo nuevo: contadores, resumen y párrafos de otros ---------------- */

  const applyLive = useCallback((res: LiveResponse) => {
    setStats((s) => (res.stats.lastN >= s.lastN ? res.stats : s));
    setSummary((cur) => (!cur || (res.summary && res.summary.afterN >= cur.afterN) ? res.summary : cur));
    const incoming = res.paragraphs;
    if (!incoming.length) return;
    const el = parchRef.current;
    const tail = itemsRef.current.at(-1)?.n ?? 0;
    const itemsAtEnd = itemsRef.current.length === 0 || tail >= Math.max(statsRef.current.lastN, incoming[0].n - 1);
    if (itemsAtEnd) {
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) stickBottom.current = "smooth";
      setItems((cur) => appendContiguous(cur, incoming));
    }
    const al = authorsRef.current;
    if (al && al.scrollHeight - al.scrollTop - al.clientHeight < 60) authorsToBottom.current = true;
    setAuthors((cur) => appendContiguous(cur, incoming.map(toAuthor)));
    setLatest((cur) => (!cur || incoming[incoming.length - 1].n > cur.n ? incoming[incoming.length - 1] : cur));
  }, []);

  const pollLive = useCallback(
    async (fresh = false): Promise<LiveResponse | null> => {
      if (busy.current.live) return null;
      busy.current.live = true;
      try {
        const res = await getJSON<LiveResponse>(`/api/live?after=${knownLast()}${fresh ? `&t=${Date.now()}` : ""}`);
        applyLive(res);
        return res;
      } catch {
        return null;
      } finally {
        busy.current.live = false;
      }
    },
    [applyLive],
  );

  // Carga el final del libro desde cero (al abrir sin datos o al pulsar «Bajar hasta el final»).
  const reloadTail = useCallback(async () => {
    setBookLoad("loading");
    try {
      const live = await getJSON<LiveResponse>(`/api/live?after=${knownLast()}&t=${Date.now()}`);
      const last = Math.max(live.stats.lastN, knownLast());
      const needAuthors = authorsListRef.current.length === 0;
      const [{ paragraphs }, authorsRes] = await Promise.all([
        getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?before=${last + 1}&limit=${PAGE}`),
        needAuthors ? getJSON<{ authors: AuthorEntry[] }>(`/api/authors?before=${last + 1}&limit=${AUTHORS_PAGE}`) : null,
      ]);
      setStats((s) => (live.stats.lastN >= s.lastN ? live.stats : s));
      setSummary((cur) => (!cur || (live.summary && live.summary.afterN >= cur.afterN) ? live.summary : cur));
      if (authorsRes) {
        authorsToBottom.current = true;
        setAuthors(authorsRes.authors);
      } else {
        setAuthors((cur) => appendContiguous(cur, live.paragraphs.map(toAuthor)));
      }
      stickBottom.current = "instant";
      setItems(paragraphs);
      setLatest(paragraphs.at(-1) ?? null);
      setBookLoad("idle");
    } catch {
      setBookLoad("error");
    }
  }, []);

  /* ---------------- Saltar a un párrafo ---------------- */

  const jumpTo = useCallback(async (n: number, opts: { mark?: Mark; flash?: boolean } = {}) => {
    setDrawer(null);
    const apply = () => {
      setMark(opts.mark ?? { n, user: null, query: null });
      pendingScroll.current = { n, flash: opts.flash ?? true };
      setTick((t) => t + 1);
    };
    const cur = itemsRef.current;
    const lo = cur[0]?.n ?? 0;
    const hi = cur.at(-1)?.n ?? 0;
    if (cur.length && n >= lo && n <= hi) return apply();
    try {
      if (cur.length && n < lo && lo - n <= 80) {
        const { paragraphs } = await getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?from=${n}&to=${lo - 1}`);
        if (itemsRef.current[0]?.n === lo) {
          const el = parchRef.current;
          if (el) parAnchor.current = { h: el.scrollHeight, top: el.scrollTop };
          setItems((c) => [...paragraphs.filter((p) => p.n < lo), ...c]);
        }
      } else if (cur.length && n > hi && n - hi <= 80) {
        const { paragraphs } = await getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?from=${hi + 1}&to=${n}&t=${Date.now()}`);
        setItems((c) => appendContiguous(c, paragraphs));
        setAuthors((c) => appendContiguous(c, paragraphs.map(toAuthor)));
      } else {
        const { paragraphs } = await getJSON<{ paragraphs: Paragraph[] }>(`/api/paragraphs?from=${Math.max(1, n - 10)}&to=${n + 30}`);
        if (!paragraphs.some((p) => p.n === n)) throw new Error("no está");
        setItems(paragraphs);
      }
      apply();
    } catch {
      setToast("No hemos podido abrir ese párrafo. Inténtalo de nuevo.");
    }
  }, []);

  /* ---------------- Publicar ---------------- */

  const openWrite = useCallback((draft: Partial<Draft> | null = null) => {
    setDrawer(null);
    setWrite((w) => ({ open: true, draft, key: w.key + 1 }));
  }, []);

  const onPublished = useCallback(
    async (n: number) => {
      setWrite((w) => ({ ...w, open: false }));
      setFreshN(n);
      setQuery("");
      await pollLive(true);
      authorsToBottom.current = true;
      await jumpTo(n);
      setToast(`Publicado. Eres el autor del párrafo ${fmt(n)} de El Libro Infinito.`);
    },
    [pollLive, jumpTo],
  );

  // Vuelta del pago: esperamos a que se confirme y saltamos al párrafo.
  const waitForPublish = useCallback(
    async (id: string) => {
      setReturning({ phase: "waiting" });
      for (let i = 0; i < 30; i++) {
        try {
          const r = await getJSON<{ status: string; n: number | null }>(`/api/submission?id=${id}`);
          if (r.status === "published" && r.n) {
            setReturning(null);
            clearDraft();
            await onPublished(r.n);
            return;
          }
          if (r.status === "cancelled") {
            setReturning({ phase: "failed" });
            return;
          }
        } catch {}
        await sleep(i < 10 ? 1500 : 3000);
      }
      setReturning({ phase: "slow" });
    },
    [onPublished],
  );

  /* ---------------- Efectos ---------------- */

  // Al abrir la página: datos si faltan, vuelta del pago o enlace de invitación.
  useEffect(() => {
    setNow(Date.now());
    // La portada puede venir de la caché con unos segundos de retraso: nos ponemos al día enseguida.
    if (!initial.ok) reloadTail();
    else pollLive();
    const params = new URLSearchParams(window.location.search);
    const pago = params.get("pago");
    const envio = params.get("envio") ?? "";
    const inv = params.get("inv");
    if (pago || inv) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (pago === "ok" && UUID.test(envio)) {
      waitForPublish(envio);
    } else if (pago === "cancelado" && UUID.test(envio)) {
      fetch(`/api/submission?id=${envio}`, { method: "DELETE" })
        .then((r) => r.json())
        .then((r: { status?: string; n?: number }) => {
          if (r.status === "published" && r.n) return onPublished(r.n);
          openWrite(loadDraft());
          setToast("Pago cancelado. No se te ha cobrado nada y tu párrafo sigue aquí.");
        })
        .catch(() => openWrite(loadDraft()));
    } else if (pago === "error") {
      (UUID.test(envio) ? getJSON<{ status: string; n: number | null }>(`/api/submission?id=${envio}`) : Promise.reject())
        .then((r) => {
          if (r.status === "published" && r.n) return onPublished(r.n);
          throw new Error("sin publicar");
        })
        .catch(() => {
          openWrite(loadDraft());
          setToast("No se ha podido completar el pago. Puedes intentarlo de nuevo.");
        });
    } else if (inv) {
      openWrite({ ...loadDraft(), invite: inv });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Consulta lo nuevo cada pocos segundos mientras la pestaña está visible.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      let soon = false;
      if (!document.hidden) {
        const res = await pollLive();
        soon = Boolean(res && res.stats.lastN > knownLast());
      }
      timer = setTimeout(loop, soon ? 2000 : POLL_MS);
    };
    timer = setTimeout(loop, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) pollLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollLive]);

  // Búsqueda de autores en todo el libro.
  useEffect(() => {
    const q = lower(query.trim());
    if (q.length < 2) {
      setResults((r) => {
        if (r) authorsToBottom.current = true;
        return null;
      });
      setMark((m) => (m.query ? NO_MARK : m));
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { authors: hits } = await getJSON<{ authors: AuthorEntry[] }>(`/api/authors?q=${encodeURIComponent(q)}`);
        setResults(hits);
        if (hits.length) await jumpTo(hits[hits.length - 1].n, { mark: { n: null, user: null, query: q }, flash: false });
        else setMark(NO_MARK);
      } catch {
        setResults([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, jumpTo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  /* ---------------- Pintado ---------------- */

  const softFor = (p: Paragraph) => {
    if (mark.user) return p.n !== mark.n && lower(p.username) === mark.user;
    if (mark.query) return lower(p.username).includes(mark.query);
    return false;
  };

  let topNote: React.ReactNode;
  if (!first) {
    topNote =
      bookLoad === "loading" ? (
        <div className="top-note loading">Abriendo el libro…</div>
      ) : bookLoad === "error" ? (
        <button type="button" className="top-note retry" onClick={reloadTail}>
          No hemos podido abrir el libro. Toca para reintentar.
        </button>
      ) : (
        <div className="top-note">El libro está esperando su primer párrafo.</div>
      );
  } else if (first.n === 1) {
    topNote = <div className="top-note origin">Principio del libro · {longDate(first.created_at)}</div>;
  } else if (older === "loading") {
    topNote = <div className="top-note loading">Desenrollando páginas anteriores…</div>;
  } else if (older === "error") {
    topNote = (
      <button type="button" className="top-note retry" onClick={loadOlder}>
        No se han podido cargar las páginas anteriores. Toca para reintentar.
      </button>
    );
  } else {
    topNote = (
      <div className="top-note">
        Sube para seguir desenrollando. Faltan {fmt(first.n - 1)} párrafos anteriores.
      </div>
    );
  }

  const list = results ?? authors;
  const showLatest = latest && summary && latest.n > summary.afterN;
  const excerpt = latest ? (latest.body.length > 140 ? latest.body.slice(0, 140).trim() + "…" : latest.body) : "";

  return (
    <>
      <div className="app">
        <header className="top">
          <div className="brand">
            <h1>
              El Libro <i>Infinito</i>
            </h1>
          </div>
          <div className="head-mid">
            <p className="motto">
              <span className="l1">Esta historia está haciendo historia.</span>
              <span className="l2">Deja tu párrafo y un trocito será tuyo para siempre.</span>
            </p>
            <div className="act-row">
              <button className="drawer-btn" onClick={() => setDrawer("authors")} aria-controls="authorsPanel">
                Autores
              </button>
              <button className="drawer-btn" onClick={() => setDrawer("summary")} aria-controls="summaryPanel">
                Resumen
              </button>
              <button className="cta" onClick={() => openWrite()}>
                Escribir un párrafo · 1 €
              </button>
            </div>
          </div>
          <div className="meta" aria-live="polite">
            <div>
              <b>{fmt(stats.paragraphs)}</b>
              <span>párrafos</span>
            </div>
            <div>
              <b>{fmt(stats.authors)}</b>
              <span>autores</span>
            </div>
            <div>
              <b>{fmt(stats.words)}</b>
              <span>palabras</span>
            </div>
          </div>
        </header>

        <main className="main">
          <aside className={"side left" + (drawer === "authors" ? " open" : "")} id="authorsPanel" aria-label="Autores del libro">
            <button className="side-close" onClick={() => setDrawer(null)} aria-label="Cerrar">
              ×
            </button>
            <div>
              <h2>Quién lo ha escrito</h2>
              <p className="sub">En orden de llegada. Toca un nombre o búscalo para ver en el papiro lo que escribió.</p>
            </div>
            <input
              className="search"
              type="search"
              placeholder="Buscar un nombre…"
              autoComplete="off"
              aria-label="Buscar un nombre"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ol className="authors" ref={authorsRef} onScroll={results ? undefined : onAuthorsScroll}>
              {!results && authors[0] && authors[0].n > 1 && (
                <li className="more">
                  {authorsLoad === "error" ? (
                    <button type="button" onClick={loadOlderAuthors}>
                      Reintentar
                    </button>
                  ) : (
                    `Sube para ver ${fmt(authors[0].n - 1)} autores más…`
                  )}
                </li>
              )}
              {results && results.length === 0 && <li className="empty">Nadie con ese nombre ha escrito todavía. ¿Serás tú?</li>}
              {list.map((a) => (
                <li
                  key={a.n}
                  className={[a.gold && "gold", mark.n === a.n && "active", freshN === a.n && "fresh"].filter(Boolean).join(" ") || undefined}
                >
                  <button type="button" onClick={() => jumpTo(a.n, { mark: { n: a.n, user: lower(a.username), query: null } })}>
                    <span className="n">{a.n}</span>
                    <span className="u">{a.username}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="side-foot">
              <a href="/terminos">Términos de uso</a>
              <a href="/terminos#normas">Normas</a>
              <a href="/terminos#privacidad">Privacidad</a>
              <a href="/terminos#aviso-legal">Aviso legal</a>
            </div>
          </aside>

          <section className="center" aria-label="El libro">
            <div className="scroll">
              <div className="roll" aria-hidden="true" />
              <div className="parchment" ref={parchRef} onScroll={onParchScroll} tabIndex={0}>
                <div className="book-wrap">
                  {topNote}
                  <div>
                    {items.map((p) => (
                      <Par key={p.n} p={p} hl={mark.n === p.n} soft={softFor(p)} />
                    ))}
                  </div>
                  {atEnd ? (
                    <div className="next">
                      <span className="num-big">Párrafo {fmt(nextN)}</span>
                      <p>El siguiente párrafo puede ser tuyo.</p>
                      <button className="ink-btn" onClick={() => openWrite()}>
                        Continuar la historia · 1 €
                      </button>
                      <SecurePay />
                    </div>
                  ) : (
                    <>
                      <div className="top-note loading">{newer === "error" ? "" : "Desenrollando…"}</div>
                      <div className="to-end">
                        <button className="ink-btn" onClick={reloadTail}>
                          Bajar hasta el final ↓
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="roll" aria-hidden="true" />
            </div>
          </section>

          <aside className={"side right" + (drawer === "summary" ? " open" : "")} id="summaryPanel" aria-label="Resumen de la historia">
            <button className="side-close" onClick={() => setDrawer(null)} aria-label="Cerrar">
              ×
            </button>
            <div>
              <h2>La historia hasta ahora</h2>
              {summary && (
                <p className="updated">
                  <span className="dot" />
                  Actualizado tras el párrafo {fmt(summary.afterN)}
                  {now ? ` · ${ago(summary.updatedAt, now)}` : ""}
                </p>
              )}
            </div>
            <div className="summary">
              {showLatest && (
                <div className="latest">
                  <h3>Última hora</h3>
                  <p>
                    {latest.username} acaba de escribir el párrafo {fmt(latest.n)}: «{excerpt}»
                  </p>
                </div>
              )}
              {summary ? (
                summary.sections.map((s) => (
                  <div key={s.title}>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                ))
              ) : (
                <p className="empty">El resumen aparecerá en cuanto haya historia que resumir.</p>
              )}
              <div className="sum-cta">
                <p>¿Tienes una teoría? ¿Un giro? ¿O prefieres devolver la historia a su cauce? Escribe tú el siguiente párrafo.</p>
                <button className="cta" onClick={() => openWrite()}>
                  Escribir el párrafo {fmt(nextN)} · 1 €
                </button>
                <p className="ai-note">Este resumen lo escribe una IA leyendo el libro, y se reescribe solo cada vez que alguien publica.</p>
              </div>
            </div>
          </aside>
        </main>
        <Footer />
      </div>

      {drawer && <div className="scrim" onClick={() => setDrawer(null)} />}

      {write.open && (
        <WriteDialog
          key={write.key}
          nextN={nextN}
          initial={write.draft}
          onClose={() => setWrite((w) => ({ ...w, open: false }))}
          onPublished={onPublished}
        />
      )}

      {returning && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="returnTitle">
          <div className="sheet">
            {returning.phase === "waiting" && (
              <div className="wait" role="status" id="returnTitle">
                <span className="quill" aria-hidden="true" />
                <span>Confirmando tu pago y publicando tu párrafo…</span>
              </div>
            )}
            {returning.phase === "slow" && (
              <>
                <h2 id="returnTitle">Tu pago se está confirmando</h2>
                <p className="lead">
                  Algunos pagos tardan un poco más. Tu párrafo aparecerá en el libro en cuanto se confirme; puedes cerrar esta ventana y
                  volver en unos minutos.
                </p>
                <div className="row">
                  <button className="ink-btn" onClick={() => setReturning(null)}>
                    Entendido
                  </button>
                </div>
              </>
            )}
            {returning.phase === "failed" && (
              <>
                <h2 id="returnTitle">El pago no se completó</h2>
                <p className="lead">No se ha publicado nada ni se te ha cobrado. Tu párrafo sigue guardado por si quieres intentarlo de nuevo.</p>
                <div className="row">
                  <button className="ghost" onClick={() => setReturning(null)}>
                    Cerrar
                  </button>
                  <button
                    className="ink-btn"
                    onClick={() => {
                      setReturning(null);
                      openWrite(loadDraft());
                    }}
                  >
                    Volver a intentarlo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
