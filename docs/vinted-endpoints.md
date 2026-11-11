# Endpoints de vinted.es que usa ResellPilot

Comprobados el 2026-11-10 con la sesión del usuario en Chrome, solo con peticiones `GET`.
Vinted no publica esta API: puede cambiar sin aviso. Si cambia el formato, la extensión se para
(`VintedFormatError`) en vez de guardar datos erróneos.

## Cómo se leen

- Desde el content script de la extensión, en una pestaña `https://www.vinted.es/*` abierta por el usuario.
- `fetch` del mismo origen con `credentials: 'same-origin'`: el navegador adjunta la sesión; la extensión
  nunca lee ni guarda cookies, contraseñas ni tokens (no tiene el permiso `cookies`).
- Cabecera `Accept: application/json` **obligatoria**: sin ella Vinted devuelve el HTML de la aplicación.
- `redirect: 'manual'`: una redirección se trata como señal de verificación o sesión cerrada.
- Una petición cada `READ_MIN_INTERVAL_S` segundos como mínimo (3 s por defecto).
- Una sync normal son 5 peticiones: usuario, armario (1 página), notificaciones (hasta 2) e inbox.

## Cuándo se para (Regla 5)

| Respuesta | Qué se hace |
| --- | --- |
| 403, 429 | Pausa. Aviso en el panel, en el icono y por Telegram. |
| 401 | Pausa: sesión cerrada. |
| Redirección o 200 sin JSON | Pausa: posible captcha o verificación. |
| Captcha visible en la pestaña | Pausa antes de pedir nada. |
| Formato inesperado | Pausa (`VintedFormatError`). |
| Otros errores HTTP (404, 5xx) | Pausa. |
| Fallo de red | No pausa; se reintenta en la siguiente sync programada. |

Tras una pausa no se reintenta sola: solo se reanuda con «Reanudar» en el panel de la extensión.

## Lectura de la cuenta (Fase 3)

### `GET /api/v2/users/current`
Devuelve `{ user: { id, login, … } }`. Solo se usa `user.id` (numérico) para pedir el armario y para
no mezclar dos cuentas en la misma base de datos. Contiene datos personales (email, nombre): no se
envían al server.

### `GET /api/v2/wardrobe/{user_id}/items?page=1&per_page=50&order=relevance`
Mis anuncios, incluidos vendidos, ocultos y borradores.

```
{ items: [ { id, title, price: { amount: "20.0", currency_code }, favourite_count, view_count,
             is_draft, is_closed, is_reserved, is_hidden, item_closing_action: null | "sold",
             status: "Muy bueno", photos: [ { high_resolution: { timestamp } } ], … } ],
  pagination: { current_page, total_pages, total_entries, per_page } }
```

- **Estado**: sale de los flags (`is_draft` → borrador, `item_closing_action = "sold"` → vendido,
  `is_closed` → cerrado, `is_reserved` → reservado, `is_hidden` → oculto, si no → activo).
  El campo `status` es el estado de uso («Muy bueno»), no el del anuncio.
- **Fecha de publicación**: no viene como campo. Se usa el `timestamp` más antiguo de las fotos
  (momento de subida), que coincide con la publicación salvo que se cambien las fotos después.
- Se piden todas las páginas (máx. 20). Un anuncio que ya no aparece pasa a «Ya no está».

### `GET /web/api/notifications/notifications?page=1&per_page=20`
Notificaciones de la campana. (`/api/v2/notifications` ya no existe: devuelve 404.)

```
{ notifications: [ { id: "uuid", entry_type: 20, body, link, subject_id, user_id,
                     is_read, updated_at, photo, … } ],
  pagination: { current_page, per_page, total_entries, total_pages } }
```

- `entry_type = 20`: «X ha marcado como favorito tu artículo "…"». `user_id` es quien dio favorito,
  `subject_id` y el `link` (`/items/{id}/want_it/new?offering_id={user}`) dan el anuncio, y el
  nombre de usuario es la primera palabra del `body`. De aquí salen los **favoritos por anuncio**
  (tabla `favoriters`); Vinted no ofrece una lista de favoritos por anuncio para el vendedor.
- Otros `entry_type` se clasifican por el texto (venta, mensaje u otro). Solo se ha observado el 20.
- **Efecto secundario**: pedir esta lista marca las notificaciones como leídas en Vinted, igual que
  abrir la campana. Por eso el estado «leída» de ResellPilot es propio y solo se toma de Vinted la
  primera vez que se ve cada notificación.
- Solo se leen las 2 primeras páginas en cada sync.

### `GET /api/v2/inbox?page=1&per_page=20`
Lista de conversaciones (solo el resumen; no se abre ninguna, porque eso la marcaría como leída).

```
{ conversations: [ { id, description, unread, updated_at, item_count,
                     opposite_user: { id, login } } ],
  pagination: { … } }
```

- `unread = true` genera un evento «mensaje» con id `m:{conversación}:{updated_at}`: si llega otro
  mensaje a la misma conversación, es un evento nuevo.
- `opposite_user.id` marca `favoriters.has_conversation` (lo usará la Fase 5 para no escribir a
  quien ya tiene conversación).
- El resumen no dice a qué anuncio se refiere la conversación.

### Ventas
No hay un endpoint de ventas: se detectan cuando un anuncio conocido pasa a `vendido` entre dos syncs.

### Visto pero no usado
- `GET /api/v2/transactions/{id}/offers/seller_options`: opciones de oferta del vendedor. Lo carga
  la web al abrir una conversación; candidato para la Fase 5.

## Búsquedas públicas (Fase 4)

Vinted ya no expone la búsqueda como API JSON (`/api/v2/catalog/items` devuelve 404): los resultados
vienen renderizados en el HTML.

### `GET /catalog?search_text={consulta}`
Primera página de resultados (≈96 tarjetas), con `Accept: text/html`. El content script la convierte
con `DOMParser` y de cada `[data-testid="grid-item"]` extrae solo:

| Dato | De dónde |
| --- | --- |
| id del artículo | `data-testid="product-item-id-{id}"` |
| precio | `[data-testid$="--price-text"]` («13,00 €») |
| favoritos | `[data-testid="favourite-count-text"]` (no existe si son 0) |
| total | texto «500+ resultados» de la página |

No se extrae ni se guarda nada de los vendedores (nombre, foto, valoraciones) ni los títulos.
Si la página no contiene el buscador del catálogo ni tarjetas, se trata como verificación y se para.

### Fecha de publicación: no existe en los resultados
Ni la tarjeta ni la URL de la foto llevan fecha. La antigüedad se **estima a partir del id**: los ids
de Vinted son correlativos y crecen a un ritmo muy estable (~13,3 millones al día, medido el
2026-11-10 con anuncios propios de fecha conocida).

- `GET /catalog?order=newest_first` (una vez por tanda) da el id más alto del momento: «ahora».
- antigüedad ≈ (id_máximo − id) / ids_por_día, con un mínimo de 1 día.
- El ritmo se recalibra solo con los puntos «id máximo ↔ fecha» de días distintos.
- `favs_per_day` = favoritos totales / días totales de las tarjetas. Es una estimación para
  comparar búsquedas entre sí, no una cifra exacta.

### Límites
Como mucho 8 búsquedas por sync, `TRENDS_MAX_REQ_PER_HOUR` por hora y una medición por búsqueda cada
`TRENDS_CACHE_H` horas; todas con la pausa `READ_MIN_INTERVAL_S` y las mismas reglas de parada.
