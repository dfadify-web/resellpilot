import type { TrendView } from '@resellpilot/shared';
import { useEffect, useRef, useState } from 'react';
import { api, describeError } from './api';

export type PriceSearch =
  | { phase: 'idle' }
  | { phase: 'waiting'; query: string; since: number; warning: string | null }
  | { phase: 'done'; query: string; trend: TrendView }
  | { phase: 'error'; message: string };

const POLL_MS = 4000;
/** Si en este tiempo no llega, se deja de esperar (la extensión puede estar cerrada). */
const TIMEOUT_MS = 3 * 60_000;

/**
 * Busca en Vinted el precio de un producto: pide la búsqueda al server y espera a que la extensión la mida
 * (la recoge cada 30 s). Si ya había una medición reciente, la devuelve al momento.
 */
export function usePriceSearch(onDone?: (trend: TrendView) => void) {
  const [state, setState] = useState<PriceSearch>({ phase: 'idle' });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  async function start(text: string) {
    try {
      const response = await api.searchPrice(text);
      if (response.status === 'medida' && response.trend) {
        setState({ phase: 'done', query: response.query, trend: response.trend });
        doneRef.current?.(response.trend);
        return;
      }
      const { vinted } = response;
      const warning = vinted.paused
        ? 'La extensión está en pausa: reanúdala desde su panel para que pueda buscar.'
        : !vinted.last_sync_at
          ? 'La extensión aún no se ha conectado: actívala y abre una pestaña de vinted.es.'
          : null;
      setState({ phase: 'waiting', query: response.query, since: Date.now(), warning });
    } catch (error) {
      setState({ phase: 'error', message: describeError(error).message });
    }
  }

  const waiting = state.phase === 'waiting' ? state : null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      if (Date.now() - waiting.since > TIMEOUT_MS) {
        setState({
          phase: 'error',
          message: 'La extensión no ha hecho la búsqueda. Comprueba que está activa y que hay una pestaña de vinted.es abierta.',
        });
        return;
      }
      try {
        const response = await api.priceSearchStatus(waiting.query);
        if (response.status === 'medida' && response.trend) {
          setState({ phase: 'done', query: response.query, trend: response.trend });
          doneRef.current?.(response.trend);
        }
      } catch {
        // Un fallo puntual de red no corta la espera.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  return { state, start, reset: () => setState({ phase: 'idle' }) };
}
