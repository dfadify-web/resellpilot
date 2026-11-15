import { NAV_ITEMS } from '@resellpilot/shared';
import {
  Bell,
  LayoutDashboard,
  Monitor,
  Moon,
  Package,
  Settings2,
  Shirt,
  Sparkles,
  Sun,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme, type ThemeChoice } from '../theme';
import { useHealth, type Health } from '../useHealth';
import { Wordmark } from './Logo';

const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/anuncios': Shirt,
  '/notificaciones': Bell,
  '/oportunidades': Sparkles,
  '/tendencias': TrendingUp,
  '/inventario': Package,
  '/ajustes': Settings2,
};

const HEALTH: Record<Health, { label: string; dot: string }> = {
  comprobando: { label: 'Conectando…', dot: 'bg-faint' },
  ok: { label: 'Server en línea', dot: 'bg-accent' },
  caido: { label: 'Server caído', dot: 'bg-pink-ink' },
};

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex rounded-full border border-line bg-bg p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          title={label}
          onClick={() => setTheme(value)}
          className={`grid h-7 flex-1 cursor-pointer place-items-center rounded-full transition ${
            theme === value ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-faint hover:text-ink'
          }`}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const health = HEALTH[useHealth()];
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="z-10 flex shrink-0 flex-col border-b border-line bg-surface/80 backdrop-blur-sm md:sticky md:top-0 md:h-screen md:w-[232px] md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 pb-3 pt-5 md:pb-6 md:pt-7">
          <NavLink to="/" aria-label="ResellPilot, ir al resumen">
            <Wordmark />
          </NavLink>
          <span className="flex items-center gap-1.5 text-xs text-muted md:hidden" role="status">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${health.dot}`} />
            {health.label}
          </span>
        </div>

        <nav aria-label="Principal" className="px-3 pb-3 md:flex-1 md:pb-0">
          <ul className="scroll-soft flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = ICONS[item.path] ?? LayoutDashboard;
              return (
                <li key={item.path} className="shrink-0">
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      [
                        'group flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition',
                        isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink',
                      ].join(' ')
                    }
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden space-y-3 border-t border-line px-5 py-5 md:block">
          <ThemeSwitch />
          <p className="flex items-center gap-2 text-xs text-muted" role="status">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${health.dot}`} />
            {health.label}
            <span className="ml-auto font-mono text-[11px] text-faint">:{window.location.port || '80'}</span>
          </p>
        </div>
      </aside>

      <main key={pathname} className="min-w-0 flex-1">
        <Outlet />
        <div className="px-5 pb-8 md:hidden">
          <ThemeSwitch />
        </div>
      </main>
    </div>
  );
}
