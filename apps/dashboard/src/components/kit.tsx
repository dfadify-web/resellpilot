/**
 * Piezas del sistema de diseño: cabecera de página, tarjetas, KPIs, chips, insignias,
 * estados vacíos e ilustraciones (generadas en Google Flow, en `public/illustrations`).
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ui } from '../ui';

export type IllustrationName =
  | 'dinero'
  | 'anuncios'
  | 'notificaciones'
  | 'oportunidades'
  | 'tendencias'
  | 'inventario'
  | 'ajustes'
  | 'logo'
  | 'vacio-anuncios'
  | 'vacio-notificaciones'
  | 'vacio-oportunidades'
  | 'extension'
  | 'informe'
  | 'resumen-diario'
  | 'texto-anuncio'
  | 'bajada-precio';

const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

// ───────────────────────── ilustraciones ─────────────────────────

interface IllustrationProps {
  name: IllustrationName;
  /** Lado en px. */
  size?: number;
  className?: string;
  /** Con fondo de papel (para que se lean igual en tema oscuro). */
  framed?: boolean;
}

export function Illustration({ name, size = 120, className, framed = true }: IllustrationProps) {
  const image = (
    <img
      src={`/illustrations/${name}.png`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="pointer-events-none select-none"
      style={{ width: size, height: size }}
    />
  );
  if (!framed) return <span className={cx('inline-block shrink-0', className)}>{image}</span>;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-[28%] bg-paper ring-1 ring-ink/8 shadow-[0_10px_24px_-14px_rgb(29_36_32/0.45)]',
        className,
      )}
      style={{ width: size * 1.18, height: size * 1.18 }}
    >
      {image}
    </span>
  );
}

// ───────────────────────── cabecera ─────────────────────────

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  illustration: IllustrationName;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, illustration, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col-reverse gap-6 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 animate-rise">
        <p className={ui.eyebrow}>{eyebrow}</p>
        <h1 className={cx(ui.h1, 'mt-2')}>{title}</h1>
        {description && <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">{description}</p>}
        {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      <Illustration
        name={illustration}
        size={132}
        className="-rotate-3 self-start transition-transform duration-500 hover:rotate-0 md:self-center"
      />
    </header>
  );
}

// ───────────────────────── tarjetas ─────────────────────────

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section';
}

export function Card({ children, className, as: Tag = 'div' }: CardProps) {
  return <Tag className={cx(ui.card, className)}>{children}</Tag>;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  illustration?: IllustrationName;
  actions?: ReactNode;
}

export function CardHeader({ title, description, icon: Icon, illustration, actions }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
      <div className="flex min-w-0 items-start gap-3">
        {illustration && <Illustration name={illustration} size={44} />}
        {Icon && !illustration && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className={ui.h2}>{title}</h2>
          {description && <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────── KPIs ─────────────────────────

interface KpiProps {
  label: string;
  value: string;
  note?: ReactNode;
  icon?: LucideIcon;
  /** `feature` = tarjeta en tinta verde (la cifra principal de la página). */
  tone?: 'default' | 'feature';
}

export function Kpi({ label, value, note, icon: Icon, tone = 'default' }: KpiProps) {
  const feature = tone === 'feature';
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)]',
        feature ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cx('text-xs font-semibold uppercase tracking-[0.12em]', feature ? 'text-on-accent/75' : 'text-muted')}>
          {label}
        </p>
        {Icon && <Icon size={18} aria-hidden="true" className={feature ? 'text-on-accent/70' : 'text-faint'} />}
      </div>
      <p className={cx(ui.num, 'relative mt-3 text-[40px] leading-none')}>{value}</p>
      {note && (
        <p className={cx('relative mt-2.5 text-[13px] leading-snug', feature ? 'pr-12 text-on-accent/80' : 'text-muted')}>{note}</p>
      )}
      {feature && (
        <span aria-hidden="true" className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-pink-ink opacity-90" />
      )}
    </div>
  );
}

/** Rejilla de KPIs pequeños dentro de una sola tarjeta. */
export function StatStrip({ items }: { items: [string, string][] }) {
  return (
    <dl className={cx(ui.card, 'grid grid-cols-2 divide-line overflow-hidden lg:grid-cols-4 lg:divide-x')}>
      {items.map(([label, value]) => (
        <div key={label} className="border-line px-5 py-4 [&:nth-child(-n+2)]:border-b lg:[&:nth-child(-n+2)]:border-b-0">
          <dt className="text-xs font-medium text-muted">{label}</dt>
          <dd className={cx(ui.num, 'mt-1 text-[28px] leading-none')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────────────────────── chips e insignias ─────────────────────────

interface ChipsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}

/** Filtro de una sola opción, en píldoras. */
export function Chips<T extends string>({ value, onChange, options, label }: ChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition',
              active
                ? 'border-ink bg-ink text-bg'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cx(
                  'min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
                  active ? 'bg-bg/20 text-bg' : 'bg-sunken text-muted',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'accentSolid' | 'pink' | 'pinkSolid' | 'outline';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent-soft text-accent',
  accentSolid: 'bg-accent text-on-accent',
  pink: 'bg-pink-soft text-pink',
  pinkSolid: 'bg-pink-ink text-white',
  outline: 'border border-line-strong text-muted',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

// ───────────────────────── vacíos y avisos ─────────────────────────

interface EmptyStateProps {
  illustration: IllustrationName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ illustration, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Illustration name={illustration} size={104} className="rotate-2" />
      <p className="mt-5 font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Mensaje de confirmación tras una acción. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="animate-rise rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-ink">
      {children}
    </p>
  );
}

/** Tabla dentro de una tarjeta, con scroll horizontal si no cabe. */
export function TableCard({ children, minWidth, className }: { children: ReactNode; minWidth: number; className?: string }) {
  return (
    <div className={cx(ui.card, 'scroll-soft overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

/** Página: márgenes y ritmo vertical comunes. */
export function Page({ children }: { children: ReactNode }) {
  return <section className="mx-auto w-full max-w-[1320px] space-y-8 px-5 py-8 md:px-8 md:py-10 xl:px-10">{children}</section>;
}

interface IconButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onBlur?: () => void;
}

/** Acción compacta de tabla: solo icono, con etiqueta accesible y tooltip. */
export function IconButton({ label, icon: Icon, onClick, disabled, tone = 'default', onBlur }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onBlur={onBlur}
      className={cx(
        'grid h-8 w-8 cursor-pointer place-items-center rounded-full transition disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger' ? 'bg-pink-soft text-pink' : 'text-muted hover:bg-sunken hover:text-ink',
      )}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
