# ResellPilot

Herramienta local y gratuita para revender en vinted.es. PRD completo en `docs/PRD.md`.

## Protocolo de trabajo
- Ejecuta UNA fase cada vez.
- Al terminar una fase: corre tests, haz commit, resume en 5 líneas y PARA.
- No empieces la siguiente fase sin orden explícita.
- Si falta un dato del usuario (canal Telegram, web de enlaces, token del bot), pídelo antes de seguir.

## Reglas (obligatorias)
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

## Estructura
- `apps/server` — Fastify + better-sqlite3. Escucha solo en 127.0.0.1:4317. Sirve el dashboard.
- `apps/dashboard` — Vite + React + Tailwind. Oscuro, suizo, sin degradados ni glassmorphism, un solo color de acento.
- `apps/extension` — Chrome MV3 (@crxjs/vite-plugin), side panel.
- `packages/shared` — constantes y tipos compartidos (ajustes por defecto, estados, navegación).
- Migraciones SQL en `apps/server/src/db/migrations/NNN_nombre.sql` (se aplican solas al arrancar; nunca edites una ya aplicada, añade otra).

## Comandos
- `pnpm dev` — server + dashboard con HMR en http://localhost:4317
- `pnpm --filter @resellpilot/extension build` — compila la extensión en `apps/extension/dist` (cargar sin empaquetar en chrome://extensions)
- `pnpm dev:ext` — extensión en modo desarrollo con recarga
- `pnpm test` — Vitest
- `pnpm lint` — ESLint + typecheck
- `pnpm build` — typecheck + build de dashboard y extensión

## Convenciones de datos
- Coste total de un item = `cost + shipping_cost + extra_costs`. `PACKAGING_EUR` solo se usa en el scoring de deals (Fase 2), no en el beneficio real: el embalaje real va en `extra_costs`.
- Beneficio y ROI solo existen con `stock = vendido` y `sold_price`. Al salir de `vendido` el server borra `sold_price` y `sold_at`.
- Capital inmovilizado = coste total de items en `pedido`, `en_camino`, `en_mano`, `listado`, `reservado`.
- "Este mes" y las fechas sin hora se interpretan en hora local. Las fechas se guardan en ISO 8601 UTC.
- CSV: se exporta con `;`, coma decimal y BOM (Excel en español); se importa con `,` o `;` y punto o coma decimal. Importar es todo o nada y siempre añade filas.
- Los cálculos (`calc.ts`), el CSV y las fechas viven en `packages/shared` y son funciones puras con tests.

## Oportunidades (Fase 2)
- Fuentes en `sources.json` y marcas en `brand-blocklist.json` (raíz, editables sin reiniciar: se releen en cada búsqueda). Token del bot en `.env`, nunca en git.
- La ingesta corre al arrancar y cada 10 min; máximo 10 enlaces nuevos por fuente y ejecución, con 1 s de pausa. Se identifica con su propio User-Agent, sin headless y sin seguir enlaces a direcciones locales.
- Los enlaces cortos se resuelven siguiendo la redirección; la URL del deal se guarda normalizada (sin parámetros de seguimiento) y es la clave de deduplicación. `seen_links` evita volver a pedir enlaces ya procesados.
- La portada de dripsource.fit no tiene enlaces de producto: las fuentes web apuntan a sus páginas de categoría. La página de producto de Hacoo es una SPA sin datos: esos deals llegan con `price = null` y el título/foto del mensaje de Telegram.
- Riesgo de marca: se decide solo por el título (si la página declara una marca que el título no nombra, se añade al título). Con riesgo, score 0 y nunca recomendado.
- Scoring en `packages/shared/scoring.ts`. Para deals, envío y otros costes valen 0. Hasta la Fase 4 `est_price` es manual y demanda/competencia son desconocidas: lo desconocido suma 0 al score.
- Telegram avisa la primera vez que un deal pasa a recomendado (marca en `action_log`, acción `telegram_deal`). El chat se detecta con el primer `/start` al bot y se guarda en `settings.TELEGRAM_CHAT_ID`.

## Cuenta de Vinted (Fase 3)
- Endpoints verificados y sus efectos secundarios en `docs/vinted-endpoints.md`. Léelo antes de tocar la extensión.
- La extensión (`apps/extension`) lee con `fetch` del mismo origen desde el content script; no tiene permiso `cookies` ni `webRequest`. La lógica de normalización es pura y vive en `packages/shared/src/vinted.ts` (con tests); el content script solo pide y pagina.
- El usuario debe pulsar «Activar lectura» en el panel. Sync cada 15 min ± 2 (alarma), solo con una pestaña vinted.es abierta, una petición cada `READ_MIN_INTERVAL_S`.
- Cualquier respuesta rara de Vinted (403, 429, 401, redirección, no-JSON, formato cambiado) pausa la extensión, avisa (panel, icono, Telegram vía `/api/vinted/state`) y no se reintenta sola.
- El ID de la extensión es fijo por la `key` del manifest (`DEFAULT_EXTENSION_ID`). Las rutas `/api/vinted/{config,sync,state}` solo aceptan ese origen; el esquema de la sync es `.strict()` para que nunca entren cookies ni tokens.
- Toda petición que no sea GET con un `Origin` distinto del propio dashboard o de la extensión se rechaza (ninguna web puede escribir en la API local).
- Leer las notificaciones las marca como leídas en Vinted: el estado «leída» de ResellPilot es propio (`/api/notifications/read`).
- Tipos de notificación: favorito = `entry_type 20` o «ha marcado como favorito tu»; venta y mensaje solo con frases sobre los anuncios propios («has vendido», «te ha enviado un mensaje»…). Los avisos de anuncios ajenos («un artículo de tus favoritos ha bajado de precio / se ha vendido») son `otro` y no avisan por Telegram.
- Favoriters salen de las notificaciones `entry_type = 20`. Ventas: anuncio conocido que pasa a `vendido`. Mensajes: conversaciones con `unread`. La primera sync no avisa por Telegram.
- Un anuncio que desaparece del armario completo pasa a `no_visible`. Un item solo puede estar enlazado a un anuncio.

## Tendencias (Fase 4)
- Lógica pura en `packages/shared/src/trends.ts`; server en `apps/server/src/trends`. La búsqueda de Vinted es HTML, no API: ver `docs/vinted-endpoints.md`.
- `TRENDS_MAX_REQ_PER_HOUR` cuenta las búsquedas medidas y también las peticiones de calibración (`settings.TRENDS_CALIBRATIONS`, últimas 2 h), y reserva una para la siguiente calibración.
- Consultas = semillas (Ajustes) + derivadas de items sin vender y de deals `nuevo` sin riesgo (primeras 3 palabras clave, mínimo 2). `GET /api/vinted/config` entrega a la extensión solo las que toca medir (caché, límite por hora, 8 por sync).
- La fecha de publicación no existe en los resultados: la antigüedad se estima por el id (`IdClock`, anclas en `settings.VINTED_ID_ANCHORS`). `favs_per_day` es favoritos totales / días totales.
- `deals.est_manual` (migración 003): el precio estimado escrito a mano no se pisa; el automático es (p25 + mediana) / 2 de la tendencia cuyas palabras están todas en el título (la más específica), con al menos 5 anuncios.
- Ajustes: `GET/PUT /api/settings` con rangos validados. `DRY_RUN` no se puede apagar hasta la Fase 5.
- Ni hacoo.pl ni dripsource.fit tienen búsqueda por URL: «Buscar en Hacoo» copia la consulta y abre `HACOO_SEARCH_URL` (editable, admite `{query}`).
- Para probar en navegador usa SIEMPRE otro puerto y BD temporal (`PORT=4318 DB_PATH=<temp>`), y comprueba `/api/vinted/status` antes de sembrar datos: el 4317 puede estar ocupado por el server real del usuario.

## Ofertas a favoritos (Fase 5)
- **Solo simulación.** La escritura real en Vinted (bajar un precio, enviar un mensaje) NO está implementada: no se pudo verificar sin escribir de verdad en la cuenta del usuario. `DRY_RUN` no se puede apagar (`PUT /api/settings` lo rechaza) y `apps/extension/src/commands.ts` detiene cualquier paso real. No implementes la escritura a ciegas: hace falta una prueba supervisada y autorizada por el usuario sobre un anuncio suyo.
- El server es la autoridad (`apps/server/src/offers/service.ts`, `advanceCommand`): la extensión pide «siguiente paso» e informa del resultado. Ahí se aplican esperas aleatorias, límite diario (contado en `action_log`, acción `offer_sent`, día local), duplicados, conversación previa, revalidación de elegibilidad y paradas. Toda esa lógica está probada también en modo real (tests con `DRY_RUN=false` en la BD).
- Elegible = anuncio `activo`, con precio, enlazado a un item `en_mano` (Regla 8) y cuyo título no tenga contenido prohibido. Regla 9 en `findForbiddenContent` (plantilla y mensaje final).
- Un comando solo se crea tras la lista de confirmación del dashboard (Regla 6); solo uno activo a la vez. En real, cualquier fallo o resultado desconocido lo deja en `failed` y nunca se reenvía.
- La extensión consulta `/api/vinted/commands/next` cada minuto y ejecuta en la pestaña de vinted.es con un overlay (shadow DOM) y botón PARAR. Un comando va siempre a la misma pestaña mientras exista (`PanelState.commandRun`, `pickCommandTab`): si no, al cambiar de pestaña correría en dos a la vez.
- Regla 5 también para comandos: con la lectura en pausa (`VINTED_PAUSED`) no se crean ni se entregan comandos, y uno en marcha termina en `failed` en su siguiente paso.

## Mejoras (Fase 6)
- Bajadas sugeridas (`packages/shared/src/repricing.ts`, `GET /api/repricing`): anuncio stale → −5 %; pasado el doble de `STALE_DAYS`, −10 % (salvo que el −10 % no cubra el coste y el −5 % sí). Tras una bajada (`price_drop` o `price_drop_manual` en `action_log`) no se sugiere otra durante `STALE_DAYS`. Solo sugiere: el dashboard copia el precio y abre `vinted.es/items/{id}/edit`; el usuario lo cambia allí.
- La sync detecta las bajadas hechas a mano (`price_drop_manual`). Si llegan a `OFFER_DISCOUNT_PCT`, los favoritos pendientes de ese anuncio pasan a ofertados.
- Generador de anuncio (`listingText.ts`): plantilla sin LLM. Solo promete plazo de envío si el item está `en_mano` o `listado` (Regla 8) y avisa de enlaces o contactos (Regla 9).
- Informes (`reports.ts`, `apps/server/src/reports`): semana de lunes a domingo en hora local; CSV con `;`, coma decimal, BOM y fila de totales. Resumen diario por Telegram con cron `30 8 * * *` y al arrancar si ya pasó la hora; una vez por día local (`action_log`, acción `daily_summary`, target `AAAA-MM-DD`). Si Telegram falla no se marca y se reintenta.
- Grupos privados: el server NO entra en Telegram. `tools/telethon_bridge.py` (opcional, Python, cuenta del usuario, solo lectura) escribe `data/telegram-private.json` (`{ updated_at, sources: { <url de sources.json>: [{ text }] } }`) y la ingesta lo lee. Más de 1 h sin actualizar = aviso en la fuente. `TELEGRAM_API_ID/HASH` solo los usa el puente.
- `logAction` acepta `ts` para que el reloj inyectado de los tests mande (el contador diario de mensajes cuenta solo dentro del día local).

## Estado
- Fase 0 (Base): hecha.
- Fase 1 (Inventario y beneficios): hecha.
- Fase 2 (Oportunidades Hacoo): hecha. Pendiente del usuario: enviar /start al bot para recibir avisos.
- Fase 3 (Extensión: lectura de mi cuenta): hecha. Pendiente del usuario: cargar `apps/extension/dist` en chrome://extensions y pulsar «Activar lectura».
- Fase 4 (Tendencias): hecha.
- Fase 5 (Ofertas a favoritos): hecha SOLO en simulación (DRY_RUN). Pendiente: escritura real en Vinted, que requiere autorización del usuario para una prueba supervisada. Mientras, las bajadas se hacen a mano con «Editar en Vinted» y la sync las registra.
- Fase 6 (Mejoras): hecha. README con el setup completo. Pendiente del usuario (opcional): `TELEGRAM_API_ID/HASH` y el puente de Telethon si quiere grupos privados.
