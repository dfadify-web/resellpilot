import { NAV_ITEMS } from '@resellpilot/shared';
import { NavLink, Outlet } from 'react-router-dom';
import { useHealth, type Health } from '../useHealth';

const HEALTH_LABEL: Record<Health, string> = {
  comprobando: 'Comprobando…',
  ok: 'Server en línea',
  caido: 'Server caído',
};

export function Layout() {
  const health = useHealth();

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-panel md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="border-b border-line px-5 py-5">
          <p className="font-display text-3xl font-bold uppercase leading-none tracking-tight">
            Resell<span className="text-accent">Pilot</span>
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted">Vinted.es · local</p>
        </div>

        <nav aria-label="Principal" className="flex-1 py-2">
          <ul className="flex overflow-x-auto md:block">
            {NAV_ITEMS.map((item, index) => (
              <li key={item.path} className="shrink-0">
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    [
                      'flex items-baseline gap-3 border-l-2 px-5 py-2.5 font-display text-xl font-semibold uppercase tracking-wide transition-colors',
                      isActive
                        ? 'border-accent text-paper'
                        : 'border-transparent text-muted hover:text-paper',
                    ].join(' ')
                  }
                >
                  <span className="w-5 text-xs font-semibold text-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-line px-5 py-4 text-[11px] uppercase tracking-[0.14em] text-muted">
          <p className="flex items-center gap-2" role="status">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 ${health === 'ok' ? 'bg-accent' : 'bg-muted'}`}
            />
            {HEALTH_LABEL[health]}
          </p>
          <p className="mt-1.5">127.0.0.1:4317</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
