import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Diálogo modal nativo: foco atrapado y cierre con Esc. Fondo opaco, sin desenfoque. */
export function Modal({ title, onClose, children }: Props) {
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
      className="m-auto w-[calc(100%-2rem)] max-w-xl border border-line bg-panel p-0 text-paper backdrop:bg-ink/85"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-3xl font-bold uppercase leading-none">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] uppercase tracking-[0.14em] text-muted hover:text-paper"
        >
          Cerrar
        </button>
      </header>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}
