import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Illustration, type IllustrationName } from './kit';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  illustration?: IllustrationName;
  /** Ancho máximo: `md` (formularios) o `lg` (listas de confirmación). */
  size?: 'md' | 'lg';
}

/** Diálogo modal nativo: foco atrapado y cierre con Esc. */
export function Modal({ title, onClose, children, illustration, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // showModal enfoca el primer elemento enfocable (el botón Cerrar): llevamos el foco al primer campo.
    dialog.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={`m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-[1.5rem] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] ${
        size === 'lg' ? 'max-w-2xl' : 'max-w-xl'
      }`}
    >
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <header className="flex items-center gap-3 border-b border-line px-6 py-4">
          {illustration && <Illustration name={illustration} size={36} />}
          <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="ml-auto grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-sunken hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}
