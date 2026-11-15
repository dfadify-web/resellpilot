import type { FastifyReply, FastifyRequest } from 'fastify';

/** Cabecera propia con la que la extensión se identifica (ver `apps/extension/src/background.ts`). */
export const EXTENSION_HEADER = 'x-resellpilot-client';
export const EXTENSION_HEADER_VALUE = 'extension';

/**
 * ¿La petición viene de la extensión de ResellPilot?
 *
 * Chrome no siempre envía `Origin` en las peticiones de una extensión a un host para el que tiene
 * permiso: las GET del service worker llegan sin él. Por eso se acepta:
 * - `Origin: chrome-extension://<id de la extensión>`, o
 * - ningún `Origin` y la cabecera propia `x-resellpilot-client: extension`.
 *
 * Una web no puede imitar ninguna de las dos: su navegador pone su propio `Origin` en toda petición
 * entre orígenes que lleve una cabecera propia, y el preflight solo se concede a la extensión.
 */
export function isExtensionRequest(headers: FastifyRequest['headers'], extensionOrigin: string): boolean {
  const origin = headers.origin;
  if (origin !== undefined) return origin === extensionOrigin;
  return headers[EXTENSION_HEADER] === EXTENSION_HEADER_VALUE;
}

/** Hook `onRequest` para las rutas de la extensión: solo ella, y CORS solo para su origen. */
export function extensionGuard(extensionOrigin: string) {
  return async function onlyExtension(request: FastifyRequest, reply: FastifyReply) {
    if (!isExtensionRequest(request.headers, extensionOrigin)) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
    reply.header('access-control-allow-origin', extensionOrigin).header('vary', 'Origin');
  };
}
