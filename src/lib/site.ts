// Datos de la web que se cambian a mano. Este archivo lo usan el servidor y el navegador.
export const SITE = {
  name: "El Libro Infinito",
  author: "Jesús Chusi Martín",
  agency: "IA Pro",
  agencyUrl: "https://www.iapro.top",
  agencyLabel: "www.iapro.top",
  // Fecha de lanzamiento (AAAA-MM-DD). Mientras sea null no se muestra en el pie.
  launchDate: null as string | null,
};

// Datos del titular para el aviso legal y la privacidad. Rellenar antes de lanzar.
export const LEGAL = {
  titular: "",
  nif: "",
  domicilio: "",
  email: "",
};

export function longDate(iso: string): string {
  return new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  });
}
