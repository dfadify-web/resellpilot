# ResellPilot — PRD para Claude Code

Construye una herramienta local y gratuita para revender en vinted.es: trackear anuncios y notificaciones, detectar oportunidades de compra (enlaces Hacoo) con beneficio estimado, ver tendencias y lanzar con un botón una oferta del 10 % a quienes dieron favorito.

## Protocolo de trabajo
- Ejecuta UNA fase cada vez.
- Al terminar una fase: corre tests, haz commit, resume en 5 líneas y PARA.
- No empieces la siguiente fase sin orden explícita.
- Si falta un dato del usuario (canal Telegram, web de enlaces, token del bot), pídelo antes de seguir.

## Reglas (obligatorias, cópialas a CLAUDE.md en la Fase 0)
1. Coste 0 €. Sin APIs de pago ni servicios de pago.
2. Todo local. Datos en SQLite. Nunca guardes ni envíes cookies, contraseñas ni tokens de Vinted.
3. Vinted se toca solo desde la extensión, dentro de la sesión del navegador del usuario, con una pestaña vinted.es abierta.
4. Prohibido implementar: bypass de Datadome/Cloudflare, proxies, rotación de IP o user-agent, navegador headless con sesión de Vinted, resolución de captchas, multicuenta, compra automática.
5. Ante 403, 429, captcha o verificación: para todas las acciones sobre Vinted, avisa al usuario y no reintentes solo.
6. Ninguna escritura en Vinted sin pulsación explícita del usuario y lista de confirmación previa.
7. `brand-blocklist.json` editable: todo producto cuyo título coincida se marca `riesgo_marca` y se excluye de recomendaciones. Por defecto incluye marcas de ropa, calzado y accesorios habituales.
8. Los mensajes con plazo de entrega solo se envían para artículos con `stock = en_mano`.
9. Los mensajes no incluyen enlaces externos ni datos de contacto.
10. TypeScript estricto. pnpm. Vitest para lógica (scoring, parsers, límites). UI en español.

## Stack
- Monorepo pnpm: `apps/server`, `apps/dashboard`, `apps/extension`, `packages/shared`.
- Server: Node 20, Fastify, better-sqlite3, zod, node-cron. Escucha solo en 127.0.0.1:4317.
- Dashboard: Vite + React + TypeScript + Tailwind. Servido por el server.
- Extensión: Chrome MV3, Vite + @crxjs/vite-plugin, TypeScript, side panel.
- Notificaciones: Telegram Bot API (bot propio, token en `.env`).
- Ingesta Telegram: canales públicos vía `https://t.me/s/{canal}`. Grupos privados vía Telethon (solo en Fase 6, opcional).
- Sin deploy. Arranque: `pnpm dev`.

## UI
- Oscuro, editorial, estilo suizo moderno.
- Sin degradados. Sin glassmorphism.
- Tipografía condensada bold. Un solo color de acento.
- Tablas densas. KPIs grandes.
- Navegación: Resumen, Anuncios, Notificaciones, Oportunidades, Tendencias, Inventario, Ajustes.

## Modelo de datos (SQLite)
- `items`: id, name, brand, source_url, cost, shipping_cost, extra_costs, stock (`idea|pedido|en_camino|en_mano|listado|reservado|vendido|devuelto`), sold_price, sold_at, created_at.
- `listings`: id, vinted_id, title, price, status, favs, views, listed_at, last_seen_at, item_id (nullable).
- `notifications`: id, vinted_id, type, text, listing_id, read, created_at.
- `favoriters`: id, listing_id, vinted_user_id, username, seen_at, offered_at, has_conversation.
- `deals`: id, url, source, title, price (nullable), image, found_at, est_price, est_profit, roi, demand, competition, score, risk_flags, status (`nuevo|descartado|comprado`).
- `trends`: id, query, median_price, p25_price, listings_count, avg_favs, favs_per_day, computed_at.
- `commands`: id, type, payload, status (`pending|running|done|failed|cancelled`), progress, error, created_at.
- `action_log`: id, ts, action, target, result.
- `settings`: key, value.

## Ajustes por defecto (editables en UI)
```
OFFER_DISCOUNT_PCT=10
MAX_MESSAGES_PER_DAY=15
MSG_DELAY_MIN_S=45
MSG_DELAY_MAX_S=120
READ_MIN_INTERVAL_S=3
TRENDS_MAX_REQ_PER_HOUR=60
TRENDS_CACHE_H=6
MIN_PROFIT_EUR=5
MIN_ROI_PCT=80
STALE_DAYS=14
PACKAGING_EUR=0.30
SHIP_HOURS=48
DRY_RUN=true
```

## Scoring
```
est_price   = (p25 + median) / 2 de comps
landed_cost = price + shipping_cost + extra_costs + PACKAGING_EUR
est_profit  = est_price - landed_cost
roi         = est_profit / landed_cost
score       = 100 * (0.35*norm(roi,0,3) + 0.25*norm(est_profit,0,30) + 0.25*norm(favs_per_day,0,2) + 0.15*(1 - norm(listings_count,0,300)))
si risk_flags no vacío → score = 0 y excluido
recomendado = est_profit >= MIN_PROFIT_EUR && roi >= MIN_ROI_PCT/100 && sin riesgo
```

---

## Fase 0 — Base
1. Crea el monorepo con scripts `dev`, `build`, `test`, `lint`.
2. Crea `CLAUDE.md` con la sección Reglas.
3. Crea schema SQLite, migraciones y `.env.example`.
4. Levanta Fastify con healthcheck y sirve el dashboard con la navegación completa (páginas vacías).

Hecho cuando: `pnpm dev` abre el dashboard en http://localhost:4317.

## Fase 1 — Inventario y beneficios (sin Vinted)
1. CRUD de items con estados.
2. Calcula coste total, beneficio y ROI por item.
3. KPIs en Resumen: beneficio del mes, capital inmovilizado, días medios de rotación, items por estado.
4. Import/export CSV.
5. Tests de cálculos.

Hecho cuando: puedes registrar una compra, marcarla vendida y ver el beneficio real en Resumen.

## Fase 2 — Oportunidades Hacoo
1. Pide al usuario canal/grupo de Telegram y web de enlaces. Guárdalos en `sources.json` (`type: telegram_public|telegram_private|web`, `url`, `link_regex`).
2. Ingesta con cron cada 10 min por fuente. Extrae enlaces con `link_regex`. Deduplica por URL normalizada.
3. Parser Hacoo con `fetch` (sin headless): extrae título, precio e imagen de meta tags o JSON embebido. Si falla, guarda el deal con `price = null` y muestra campo de precio manual en UI.
4. Aplica `brand-blocklist.json` y rellena `risk_flags`.
5. Hasta la Fase 4, `est_price` se introduce a mano en la tabla.
6. Página Oportunidades: orden por score, filtros (recomendado, precio máx.), botón Descartar, botón "Comprado" (crea item en estado `pedido` con su coste).
7. Telegram notifier: avisa por el bot cuando aparece un deal recomendado.
8. Tests de parsers y scoring con fixtures.

Hecho cuando: un enlace publicado en la fuente aparece en Oportunidades con beneficio estimado y llega aviso a Telegram.

## Fase 3 — Extensión: lectura de mi cuenta
1. Extensión MV3 con content script en `https://www.vinted.es/*` y side panel (estado conectado/desconectado, última sync).
2. Descubre cómo obtener: mis anuncios, notificaciones, favoritos por anuncio y mensajes. Inspecciona la red de vinted.es con la sesión del usuario. Documenta en `docs/vinted-endpoints.md`. Si no hay endpoint estable, lee el DOM.
3. Sync cada 15 min con jitter mientras haya pestaña vinted.es abierta, respetando `READ_MIN_INTERVAL_S`. Envío al server en localhost:4317 con CORS solo para el ID de la extensión.
4. Páginas Anuncios y Notificaciones: favs, vistas, días publicado, precio, estado, marca de stale (> `STALE_DAYS`).
5. Selector para enlazar anuncio ↔ item.
6. Telegram notifier: nuevo favorito, nuevo mensaje, venta.

Hecho cuando: ves todos tus anuncios y notificaciones de Vinted en el dashboard y te llega aviso de un favorito nuevo.

## Fase 4 — Tendencias
1. Queries semilla editables en Ajustes. Añade queries derivadas de tus items y de los deals.
2. La extensión ejecuta búsquedas públicas de vinted.es (solo lectura, límites `TRENDS_*`, primera página) y extrae precio, favoritos y fecha de publicación de cada resultado.
3. Calcula por query: mediana, p25, listings_count, avg_favs, favs_per_day.
4. Página Tendencias: ranking por favs_per_day y variación frente a la semana anterior. Botón "Buscar en Hacoo" que abre la búsqueda con la query.
5. Rellena `est_price`, `demand` y `competition` de los deals por coincidencia de palabras clave del título.
6. Cachea resultados `TRENDS_CACHE_H` horas.

Hecho cuando: los deals de Oportunidades muestran beneficio estimado automático y Tendencias lista productos ordenados por demanda.

## Fase 5 — Botón de ofertas a favoritos
1. **Modo A (por defecto, nativo):** para cada anuncio con favoriters sin ofertar y `stock = en_mano`, calcula precio actual − `OFFER_DISCOUNT_PCT`. Muestra lista con precio actual, precio nuevo y nº de favoriters. Con confirmación, la extensión baja el precio del anuncio. Registra en `action_log`.
2. **Modo B (mensajes):** botón "Enviar oferta −10 %" por anuncio y global en Anuncios. Crea un `command` tipo `send_offers`.
3. Antes de ejecutar, el dashboard muestra los destinatarios con casillas y vista previa del mensaje. Requiere confirmar.
4. La extensión consume `commands` pendientes desde el server. Salta usuarios con conversación previa. Envía uno a uno con espera aleatoria entre `MSG_DELAY_MIN_S` y `MSG_DELAY_MAX_S`. Respeta `MAX_MESSAGES_PER_DAY` con contador diario persistente. Nunca envía dos veces al mismo usuario por el mismo anuncio.
5. Overlay en la pestaña de Vinted con progreso y botón PARAR siempre visible.
6. Si la UI de Vinted ofrece flujo de oferta del vendedor, úsalo con el −10 %. Si lo rechaza, envía solo el mensaje con el precio final.
7. Parada inmediata y `failed` ante captcha, 403, 429, sesión cerrada o DOM inesperado.
8. `DRY_RUN=true` por defecto: simula todo, no envía, muestra el log. Solo se desactiva desde Ajustes con confirmación.
9. Plantilla editable con variables `{nombre}` `{titulo}` `{precio_final}` `{horas_envio}`:
   `Hola {nombre}, vi que te gustó {titulo}. Te lo dejo a {precio_final} € (−10 %) y lo envío en {horas_envio} h. ¿Te lo reservo?`
10. Tests de límite diario, esperas, duplicados y paradas.

Hecho cuando: en DRY_RUN el botón muestra exactamente qué se enviaría a quién, y con DRY_RUN apagado el Modo A baja el precio tras confirmar.

## Fase 6 — Mejoras
1. Sugerencias de repricing: items listados más de `STALE_DAYS` sin venta → sugerir −5 % o −10 %.
2. Generador de título, descripción y hashtags por plantilla desde los datos del item (sin LLM de pago).
3. Resumen diario por Telegram a las 08:30: ventas, favoritos nuevos, items stale, 3 mejores deals.
4. Informe semanal de beneficios en CSV.
5. Telethon opcional para grupos privados de Telegram.
6. README con setup: BotFather, cargar extensión sin empaquetar, `.env`.
7. Pase final: lint, tests, revisión de las Reglas.

Hecho cuando: README permite instalar todo desde cero en menos de 15 minutos.
