import { useEffect, useState } from 'react';

export type Health = 'comprobando' | 'ok' | 'caido';

/** Consulta /api/health al montar y cada 15 s. */
export function useHealth(): Health {
  const [health, setHealth] = useState<Health>('comprobando');

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        const body = (await res.json()) as { status?: string; db?: boolean };
        if (alive) setHealth(res.ok && body.status === 'ok' && body.db === true ? 'ok' : 'caido');
      } catch {
        if (alive) setHealth('caido');
      }
    };
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return health;
}
