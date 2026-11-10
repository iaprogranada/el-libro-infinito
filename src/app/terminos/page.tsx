import type { Metadata } from "next";
import Footer from "@/components/Footer";
import { PRICES, euros } from "@/lib/pricing";
import { LEGAL, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Términos, normas y privacidad · El Libro Infinito",
  description: "Las normas para escribir en El Libro Infinito, cómo funciona el pago y cómo tratamos tus datos.",
  alternates: { canonical: "/terminos" },
};

function Dato({ value, label }: { value: string; label: string }) {
  return value ? <>{value}</> : <span className="pending">[{label}]</span>;
}

export default function Terminos() {
  const email = LEGAL.email;
  return (
    <div className="page">
      <div className="wrap">
        <a className="back" href="/">
          ← Volver al libro
        </a>
      </div>
      <article className="sheet terms">
        <h2 id="terminos">Términos de uso</h2>
        <nav className="toc" aria-label="Apartados">
          <a href="#normas">Normas</a>
          <a href="#pago">Pago e invitaciones</a>
          <a href="#privacidad">Privacidad</a>
          <a href="#aviso-legal">Aviso legal</a>
        </nav>

        <h3>Qué es El Libro Infinito</h3>
        <p>
          Una obra colectiva que escribe cualquier persona del mundo. Cada participante añade un párrafo al final del libro. Es una idea
          original de {SITE.author} ({SITE.agency}).
        </p>

        <h3>Responsabilidad</h3>
        <p>
          Cada autor es el único responsable de lo que escribe. El Libro Infinito solo aloja los textos y no comparte ni respalda las
          opiniones o hechos que contengan. Si se nos comunica un contenido ilícito, lo retiraremos.
        </p>

        <h3 id="normas">Normas</h3>
        <p>No se publica ningún párrafo ni nombre de usuario que contenga:</p>
        <ul>
          <li>Insultos, palabrotas o palabras malsonantes, en cualquier idioma.</li>
          <li>Amenazas o incitación a la violencia contra personas reales.</li>
          <li>Odio o discriminación, contenido sexual explícito o cualquier contenido ilegal.</li>
          <li>Datos personales de otras personas (teléfonos, direcciones, correos…).</li>
          <li>Enlaces, menciones, publicidad o spam.</li>
          <li>Suplantación de otra persona, marca o de la propia web.</li>
        </ul>
        <p>
          Cada párrafo pasa un filtro automático con inteligencia artificial <b>antes del pago</b>. Si no cumple las normas, no se publica y
          no se cobra nada. El filtro puede equivocarse; si crees que ha rechazado algo por error, puedes reformularlo.
        </p>

        <h3 id="pago">Pago e invitaciones</h3>
        <p>
          Publicar un párrafo cuesta {euros(PRICES.paragraph)} (IVA incluido). Hay dos extras opcionales de {euros(PRICES.sign)} cada uno:
          firmarlo con tu nombre dentro del papiro (sin firma, tu nombre solo aparece en la lista de autores) y mostrarlo en dorado. El pago
          se hace con Stripe (tarjeta, Apple Pay o Google Pay) y, cuando esté disponible, con PayPal. Nunca vemos ni guardamos los datos de
          tu tarjeta.
        </p>
        <p>
          Los códigos de invitación permiten publicar un párrafo gratis con firma (y, según el código, también en dorado). Cada código se
          puede usar una sola vez.
        </p>
        <p>
          Al tratarse de contenido digital que se publica al momento, al pagar aceptas que se pierde el derecho de desistimiento en cuanto
          tu párrafo queda publicado.
        </p>

        <h3>Para siempre</h3>
        <p>
          Un párrafo publicado no se puede editar ni borrar. Solo lo retiraremos si incumple estas normas o por obligación legal, y en ese
          caso no se devuelve el importe.
        </p>

        <h3>Derechos sobre el texto</h3>
        <p>
          Al publicar, autorizas de forma gratuita y no exclusiva que tu párrafo forme parte del libro y de sus ediciones (web, PDF, papel y
          redes sociales), asociado a tu nombre de usuario.
        </p>

        <h3>Nombre de usuario</h3>
        <p>
          Puedes usar el nombre que quieras y repetirlo cada vez que escribas, salvo que suplante a otra persona o incumpla las normas. Los
          nombres no son exclusivos ni hace falta crear una cuenta.
        </p>

        <h2 id="privacidad">Privacidad</h2>
        <p>
          Responsable: <Dato value={LEGAL.titular} label="nombre del titular" /> · NIF <Dato value={LEGAL.nif} label="NIF" /> · Contacto:{" "}
          <Dato value={email} label="correo de contacto" />.
        </p>
        <ul>
          <li>
            <b>Lo que publicas</b> (nombre de usuario y párrafo) es público y permanente. No escribas datos personales tuyos que no quieras
            que se vean.
          </li>
          <li>
            <b>El pago</b> lo gestionan Stripe y PayPal, que reciben los datos necesarios para cobrar. Nosotros solo recibimos la
            confirmación del pago.
          </li>
          <li>
            <b>Prevención de abusos</b>: guardamos durante un máximo de 24 horas una huella cifrada de tu dirección IP para limitar los
            envíos repetidos.
          </li>
          <li>
            <b>Revisión automática</b>: tu párrafo y tu nombre se envían a Anthropic (Claude) para comprobar que cumplen las normas y para
            escribir el resumen de la historia.
          </li>
          <li>
            <b>Proveedores</b>: Vercel (alojamiento web), Supabase (base de datos), Anthropic, Stripe y PayPal. Algunos están fuera de la
            Unión Europea y trabajan con cláusulas contractuales tipo de la Comisión Europea.
          </li>
          <li>
            <b>En tu navegador</b> guardamos tu nombre de usuario y el borrador de tu párrafo para que no los pierdas. No usamos cookies de
            publicidad ni de seguimiento.
          </li>
        </ul>
        <p>
          La base legal es la ejecución del servicio que solicitas al publicar y nuestro interés legítimo en evitar abusos. Puedes ejercer
          tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a{" "}
          <Dato value={email} label="correo de contacto" />, y reclamar ante la Agencia Española de Protección de Datos (aepd.es).
        </p>

        <h2 id="aviso-legal">Aviso legal</h2>
        <p>
          Titular del sitio web: <Dato value={LEGAL.titular} label="nombre del titular" /> · NIF: <Dato value={LEGAL.nif} label="NIF" /> ·
          Domicilio: <Dato value={LEGAL.domicilio} label="domicilio" /> · Correo: <Dato value={email} label="correo de contacto" />.
        </p>
        <p>
          {SITE.name} es una idea original de {SITE.author} ({SITE.agency},{" "}
          <a href={SITE.agencyUrl} target="_blank" rel="noopener">
            {SITE.agencyLabel}
          </a>
          ). El diseño, el nombre y el concepto de la web están protegidos; cada párrafo pertenece a su autor en los términos indicados.
        </p>
      </article>
      <div className="wrap">
        <Footer />
      </div>
    </div>
  );
}
