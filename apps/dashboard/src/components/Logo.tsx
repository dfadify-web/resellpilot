/** Marca de ResellPilot: una etiqueta de precio con un ala de avión de papel. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <path
        d="M6 11.2 15.1 3.6a1.4 1.4 0 0 1 1.8 0L26 11.2V27a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"
        fill="var(--color-accent)"
      />
      <circle cx="16" cy="10.4" r="2.1" fill="var(--color-bg)" />
      <path d="M10.2 20.6 22.4 15l-4.9 11.3-1.9-4.5Z" fill="var(--color-pink-ink)" />
      <path d="m15.6 21.8 6.8-6.8" stroke="var(--color-bg)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-[21px] font-semibold leading-none tracking-[-0.03em]">
        Resell<span className="text-accent">Pilot</span>
      </span>
    </span>
  );
}
