# El Libro Infinito

Un único libro que escribe cualquier persona del mundo, un párrafo cada vez. Idea original de Jesús Chusi Martín (IA Pro, [www.iapro.top](https://www.iapro.top)).

- **Web:** Next.js 16 (App Router) en Vercel.
- **Datos:** Supabase (Postgres). Toda la escritura pasa por el servidor con la clave `service_role`; el público no tiene acceso directo a las tablas.
- **Pagos:** Stripe Checkout (tarjeta, Apple Pay, Google Pay) y PayPal (cuando se active).
- **IA:** Claude revisa cada párrafo antes del pago y reescribe el resumen de la historia.

## Cómo funciona un párrafo

1. La persona escribe su nombre y su párrafo (máx. 500 caracteres), elige extras (firma +1 €, dorado +1 €) y, si tiene, un código de invitación.
2. `POST /api/submit`: comprobaciones de forma, límite por IP, filtro rápido y filtro con IA. Si no pasa, no se cobra nada.
3. Si la invitación lo cubre todo, se publica al momento. Si no, `POST /api/checkout` abre el pago de Stripe o PayPal.
4. Stripe avisa a `/api/stripe/webhook` y el párrafo se publica. Con PayPal, el cobro se hace al volver (`/api/paypal/return`).
5. La numeración no tiene huecos y publicar es idempotente: un aviso repetido no duplica párrafos.
6. Tras publicar, el resumen se reescribe solo en segundo plano.

## Puesta en marcha

### 1. Supabase

En **SQL Editor**, ejecuta en este orden:

1. `supabase/migrations/0001_init.sql` (tablas y funciones).
2. `supabase/seed.sql` (párrafo de Chusi, los 17 de arranque y el primer resumen).
3. El archivo de invitaciones `invitaciones-lote-1.sql` (no está en el repositorio a propósito: los códigos son privados).

Copia de **Project Settings → API** la URL del proyecto y la clave `service_role`.

### 2. Vercel

Importa el repositorio y añade estas variables de entorno (ver `.env.example`):

| Variable | Qué es |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://ellibroinfinito.com` |
| `SUPABASE_URL` | URL del proyecto de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` de Supabase |
| `ANTHROPIC_API_KEY` | Clave de la API de Claude |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe (`sk_live_…`, o `sk_test_…` para probar) |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook de Stripe (`whsec_…`) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Credenciales REST de PayPal (opcional; sin ellas no sale el botón) |
| `PAYPAL_ENV` | `live` en producción, `sandbox` para probar |
| `RATE_LIMIT_SALT` | Opcional: texto aleatorio para anonimizar IPs (si falta, se usa la clave de Supabase) |

### 3. Stripe

En **Desarrolladores → Webhooks**, crea un endpoint `https://ellibroinfinito.com/api/stripe/webhook` con los eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`

Copia su secreto en `STRIPE_WEBHOOK_SECRET`.

### 4. Dominio

En Vercel, añade `ellibroinfinito.com` y `www.ellibroinfinito.com` al proyecto y copia los registros DNS que indique en Hostinger (zona DNS del dominio).

## Cosas que se cambian a mano

- `src/lib/site.ts`: fecha de lanzamiento (`SITE.launchDate`) y datos legales del titular (`LEGAL`).
- `src/lib/pricing.ts`: precios.
- `src/lib/ai.ts`: normas del filtro y tono del resumen.

## Invitaciones

Cada código vale para un párrafo y se gasta al usarlo. Tipo `firma`: párrafo y firma gratis. Tipo `oro`: párrafo, firma y dorado gratis. El enlace `https://ellibroinfinito.com/?inv=CODIGO` abre el formulario con el código ya puesto.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # y rellénalo
npm run dev
npm test        # pruebas de precios y validación
npm run lint    # comprobación de tipos
```
