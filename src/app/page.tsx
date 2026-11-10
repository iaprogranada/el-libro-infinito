import BookApp, { type InitialData } from "@/components/BookApp";
import { authorsBefore, getStats, getSummary, paragraphsBefore } from "@/lib/book";

// La portada se regenera como mucho cada 5 segundos; lo nuevo llega después por /api/live.
export const revalidate = 5;

async function load(): Promise<InitialData> {
  try {
    const stats = await getStats();
    const [paragraphs, authors, summary] = await Promise.all([
      paragraphsBefore(stats.lastN + 1, 30),
      authorsBefore(stats.lastN + 1, 300),
      getSummary(),
    ]);
    return { ok: true, stats, paragraphs, authors, summary };
  } catch (e) {
    // Sin base de datos (por ejemplo, durante el primer despliegue) la página sigue funcionando y lo reintenta en el navegador.
    console.error("[portada] no se pudo cargar el libro:", e);
    return { ok: false, stats: { paragraphs: 0, authors: 0, words: 0, lastN: 0 }, paragraphs: [], authors: [], summary: null };
  }
}

export default async function Home() {
  const initial = await load();
  return <BookApp initial={initial} />;
}
