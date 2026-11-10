import type { Metadata, Viewport } from "next";
import { EB_Garamond, IM_Fell_English, Inter } from "next/font/google";
import { siteUrl } from "@/lib/env";
import "./globals.css";

const display = IM_Fell_English({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display" });
const book = EB_Garamond({ subsets: ["latin"], variable: "--font-book" });
const ui = Inter({ subsets: ["latin"], variable: "--font-ui" });

const description =
  "Un único libro que escribe cualquier persona del mundo, un párrafo cada vez. Lee cómo va la historia y escribe tú el siguiente párrafo.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "El Libro Infinito",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "El Libro Infinito",
    description: "Esta historia está haciendo historia. Deja tu párrafo y un trocito será tuyo para siempre.",
    url: "/",
    siteName: "El Libro Infinito",
    locale: "es_ES",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "El Libro Infinito", description },
};

export const viewport: Viewport = {
  themeColor: "#17120e",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${book.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
