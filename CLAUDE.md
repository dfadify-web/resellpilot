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
- `pnpm dev:ext` — extensión en modo desarrollo (cargar `apps/extension/dist` sin empaquetar)
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

## Estado
- Fase 0 (Base): hecha.
- Fase 1 (Inventario y beneficios): hecha.
