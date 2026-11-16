# ResellPilot

Herramienta local y gratuita para revender en vinted.es: inventario y beneficios, oportunidades de compra
(enlaces Hacoo) con beneficio estimado, tendencias de Vinted, avisos por Telegram y ofertas a quien dio
favorito. Todo corre en tu ordenador; no hay servidores ni servicios de pago.

> Setup completo en unos 15 minutos. Pasos 1–3 son obligatorios; 4 y 5, opcionales.

## Requisitos

- Windows, macOS o Linux con **Node.js 20 o superior** (`node -v`).
- **pnpm 9**: `npm install -g pnpm@9` (o `corepack enable`).
- **Google Chrome** (para la extensión).
- Python 3.10+ solo si vas a usar grupos privados de Telegram (paso 5).

## 1. Instalar y arrancar (5 min)

```bash
cd resellpilot
pnpm install
cp .env.example .env        # en Windows: copy .env.example .env
pnpm dev
```

Se abre **http://localhost:4317**. El server escucha solo en `127.0.0.1`: nadie más de tu red puede verlo.
Los datos se guardan en `data/resellpilot.db` (SQLite). Para hacer copia de seguridad, copia esa carpeta
con el server parado.

Sin hacer nada más ya puedes usar **Inventario** (compras, ventas, beneficio, CSV) y **Resumen**.

## 2. Bot de Telegram para los avisos (3 min)

1. En Telegram, abre **@BotFather**, envía `/newbot` y sigue los pasos. Te da un token tipo `123456:ABC…`.
2. Pégalo en `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC…`
3. Reinicia `pnpm dev`.
4. Abre tu bot en Telegram y envíale **`/start`**. ResellPilot detecta tu chat solo
   (o pon tu id en `TELEGRAM_CHAT_ID`).
5. En **Oportunidades → Probar Telegram** comprueba que llega el mensaje.

Te avisará de: oportunidades recomendadas, favoritos nuevos, mensajes, ventas, pausas de la extensión y un
**resumen diario a las 08:30** (ventas, favoritos, anuncios stale y las 3 mejores oportunidades). Si el
equipo estaba apagado a esa hora, el resumen llega al arrancar.

## 3. Extensión de Chrome: leer tu cuenta de Vinted (5 min)

```bash
pnpm --filter @resellpilot/extension build
```

1. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
2. **Cargar descomprimida** → elige la carpeta `apps/extension/dist`.
3. Fija el icono de ResellPilot en la barra y ábrelo: sale el panel lateral.
4. Abre una pestaña de **vinted.es** con tu sesión iniciada y pulsa **«Activar lectura»**.

La extensión lee tus anuncios, notificaciones, favoritos y bandeja de entrada cada ~15 min mientras haya una
pestaña de vinted.es abierta, y mide las búsquedas de **Tendencias**. No tiene permiso para leer cookies ni
contraseñas, y no guarda ni envía tokens de Vinted. Ante un 403, 429, captcha o sesión cerrada se **pausa sola**
y te avisa; solo se reanuda cuando tú pulsas «Reanudar».

Su ID es siempre `kjgfhjhbgcpdodeknaofoemgeccffgok` (no hace falta tocar `EXTENSION_ID`). Si actualizas el
código, vuelve a hacer el build y pulsa ↻ en `chrome://extensions`.

## 4. Fuentes de oportunidades (opcional, 2 min)

- `sources.json`: canales públicos de Telegram (`telegram_public`, `https://t.me/s/<canal>`), webs de
  enlaces (`web`) y grupos privados (`telegram_private`, ver paso 5). Cada fuente lleva un `link_regex`
  con los enlaces que interesan. Se revisan al arrancar y cada 10 min.
- `brand-blocklist.json`: vacía por defecto. Si quieres que ciertas marcas no se recomienden nunca, añádelas
  aquí (por ejemplo `["Nike", "Adidas"]`); se aplica en la siguiente revisión, sin reiniciar.

## 5. Grupos privados de Telegram con Telethon (opcional)

El server solo lee canales públicos. Para un grupo privado del que ya eres miembro hay un puente aparte que
entra con **tu** cuenta y solo lee mensajes (no escribe, no se une a nada):

1. Crea una app gratis en **https://my.telegram.org → API development tools** y pon en `.env`:
   `TELEGRAM_API_ID=…` y `TELEGRAM_API_HASH=…`
2. Añade el grupo a `sources.json`, por ejemplo:
   ```json
   { "name": "Mi grupo", "type": "telegram_private", "url": "https://t.me/c/1234567890",
     "link_regex": "https?://c\\.onlyaff\\.app/[A-Za-z0-9]+" }
   ```
   Vale el enlace interno (`https://t.me/c/<id>`), el de invitación (`https://t.me/+…`) o `https://t.me/<nombre>`.
3. Instala y arranca el puente (la primera vez pide tu teléfono y el código que te manda Telegram):
   ```bash
   pip install -r tools/requirements.txt
   python tools/telethon_bridge.py
   ```
   Deja la ventana abierta: lee cada 10 min y escribe `data/telegram-private.json`, que el server recoge en
   su ingesta. La sesión queda en `data/telethon.session`: **no la compartas** (da acceso a tu Telegram).

## Uso diario

| Página | Qué hace |
| --- | --- |
| Resumen | Beneficio del mes, capital inmovilizado, rotación, últimas ventas, **informe semanal** (CSV) y vista previa del **resumen diario**. |
| Anuncios | Tus anuncios de Vinted con favoritos, vistas y días publicados. Enlaza cada anuncio con su item. **Precio de mercado**: la media en Vinted de ese mismo artículo (medida sola) y si tu anuncio está caro, en precio o barato. **Bajadas de precio sugeridas** para los stale (−5 % y, pasado el doble de `STALE_DAYS`, −10 %), con el margen que te queda. |
| Notificaciones | Favoritos, mensajes y ventas, con estado de leída propio. |
| Oportunidades | Deals de tus fuentes ordenados por score, con beneficio y ROI estimados. «Comprado» crea el item en Inventario. |
| Tendencias | Búsquedas de Vinted ordenadas por favoritos/día, con variación semanal y «Buscar en Hacoo». |
| Calculadora | **¿Me compensa?** Antes de comprar: coste, beneficio, ROI, a cuánto anunciarlo y qué oferta mínima aceptar. **«Buscar precio»** mira en Vinted a cuánto se vende de media y propone venderlo un 10 % más barato (ajustable). Guarda la compra en Inventario. |
| Inventario | Compras y ventas, beneficio real, CSV y botón **«Anuncio»**: genera título, descripción y hashtags para copiar en Vinted. |
| Ajustes | Umbrales, límites, semillas de tendencias y plantilla del mensaje de oferta. |

**Enlaza cada anuncio con su item** (Anuncios te sugiere las parejas por el título): así ves el margen de cada anuncio y,
cuando se vende en Vinted, el item pasa solo a «Vendido» con su precio y el beneficio aparece en Resumen.

**Bajar un precio**: en Anuncios, «Editar en Vinted» copia el precio sugerido y abre el anuncio en Vinted;
lo cambias tú y pulsas Guardar. La siguiente sync lo registra y no vuelve a sugerirlo hasta que pase otra
vez `STALE_DAYS`.

### Ofertas a favoritos: solo simulación

«Enviar oferta» y «Bajar precio» muestran exactamente qué se haría y a quién, y lo ejecutan en **modo
simulación** (`DRY_RUN`) con su registro. **ResellPilot todavía no escribe en Vinted**: la escritura real
necesita una prueba supervisada sobre un anuncio tuyo antes de habilitarse. Hasta entonces `DRY_RUN` no se
puede desactivar.

## Comandos

| Comando | Para qué |
| --- | --- |
| `pnpm dev` | Server + dashboard con recarga en http://localhost:4317 |
| `pnpm start` | Build del dashboard y server sin recarga |
| `pnpm --filter @resellpilot/extension build` | Compila la extensión en `apps/extension/dist` |
| `pnpm test` | Tests (Vitest) |
| `pnpm lint` | ESLint + typecheck |
| `pnpm build` | Typecheck + build de todo |

Variables de `.env`: ver `.env.example`. Para probar sin tocar tus datos:
`PORT=4318 DB_PATH=./data/prueba.db OPEN_BROWSER=false pnpm dev`.

## Problemas frecuentes

- **«El puerto 4317 ya está en uso»**: ya tienes ResellPilot abierto en otra terminal, o cambia `PORT`.
- **No llegan avisos de Telegram**: envía `/start` al bot y pulsa «Probar Telegram» en Oportunidades.
- **La extensión dice «Recarga la pestaña»**: pulsa F5 en vinted.es (pasa tras instalar o actualizar la extensión).
- **La extensión se ha pausado**: Vinted ha pedido verificación o ha limitado peticiones. Entra en vinted.es,
  resuelve lo que pida tú mismo y pulsa «Reanudar» en el panel.
- **«Esta cuenta de Vinted no es la que ya está sincronizada»**: Ajustes → Cambiar de cuenta.

## Reglas del proyecto

Las reglas (coste 0, todo local, nada de bypass de captchas ni proxies, ninguna escritura en Vinted sin
confirmación…) están en [`CLAUDE.md`](CLAUDE.md). El PRD completo, en [`docs/PRD.md`](docs/PRD.md), y los
endpoints de Vinted que se usan, en [`docs/vinted-endpoints.md`](docs/vinted-endpoints.md).
