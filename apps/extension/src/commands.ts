/**
 * Ejecución de comandos (Fase 5) dentro de la pestaña de vinted.es, con un overlay de progreso
 * y un botón PARAR siempre visible. El server decide cada paso (esperas, límite diario,
 * duplicados); aquí solo se ejecuta lo que entrega y se informa del resultado.
 *
 * En esta versión los pasos solo se SIMULAN: la escritura real en Vinted (bajar un precio,
 * enviar un mensaje) no está implementada porque no se ha podido verificar sin escribir de
 * verdad en la cuenta. Un comando real se detiene con un error claro en el primer paso.
 */
import type { CommandStep, StepResult } from '@resellpilot/shared';
import type { CommandInfo, ContentMessage } from './messages';

const REAL_WRITES_DISABLED = 'La escritura real en Vinted no está habilitada en esta versión (solo simulación).';

let running = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ask<T>(message: ContentMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

// ───────────────────────── overlay ─────────────────────────

interface Overlay {
  set(title: string, detail: string, done: number, total: number): void;
  finish(title: string, detail: string): void;
  stopRequested(): boolean;
}

function createOverlay(command: CommandInfo): Overlay {
  document.getElementById('resellpilot-overlay')?.remove();
  const host = document.createElement('div');
  host.id = 'resellpilot-overlay';
  // Shadow DOM: los estilos de Vinted no afectan al overlay ni al revés.
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 320px; box-sizing: border-box;
             background: #fbf8f2; color: #1d2420; border: 1px solid #e3dacb; border-radius: 20px;
             box-shadow: 0 24px 60px -24px rgba(29,36,32,.45);
             font: 13px/1.45 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 16px 18px; }
      .brand { font-weight: 700; font-size: 14px; letter-spacing: -.02em; color: #1d2420; }
      .brand b { color: #1f5c46; }
      .tag { float: right; background: #f8dee2; color: #c13b54; font-weight: 700; font-size: 11px; padding: 2px 9px; border-radius: 999px; }
      .title { margin-top: 10px; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
      .detail { margin-top: 4px; color: #6b675d; min-height: 38px; overflow-wrap: anywhere; }
      .bar { margin-top: 12px; height: 6px; background: #eee7da; border-radius: 999px; overflow: hidden; }
      .bar i { display: block; height: 6px; width: 0; background: #1f5c46; border-radius: 999px; transition: width .4s; }
      .count { margin-top: 6px; font-variant-numeric: tabular-nums; color: #6b675d; font-size: 12px; }
      button { margin-top: 14px; width: 100%; height: 40px; border: 0; border-radius: 999px; cursor: pointer; background: #e5566f; color: #fff;
               font: 700 14px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
      button:hover { background: #c13b54; }
      button.close { background: #fbf8f2; color: #1d2420; border: 1px solid #cdc1ab; text-transform: none; letter-spacing: 0; }
      button.close:hover { background: #eee7da; }
      button:focus-visible { outline: 2px solid #1f5c46; outline-offset: 2px; }
    </style>
    <div class="box" role="status" aria-live="polite">
      <span class="tag" hidden>Simulación</span>
      <div class="brand">Resell<b>Pilot</b></div>
      <div class="title"></div>
      <div class="detail"></div>
      <div class="bar"><i></i></div>
      <div class="count"></div>
      <button type="button">Parar</button>
    </div>`;
  document.documentElement.append(host);

  const pick = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const title = pick<HTMLElement>('.title');
  const detail = pick<HTMLElement>('.detail');
  const bar = pick<HTMLElement>('.bar i');
  const count = pick<HTMLElement>('.count');
  const button = pick<HTMLButtonElement>('button');
  pick<HTMLElement>('.tag').hidden = !command.dry_run;

  let stop = false;
  let finished = false;
  button.addEventListener('click', () => {
    if (finished) host.remove();
    else {
      stop = true;
      button.textContent = 'Parando…';
      button.disabled = true;
    }
  });

  return {
    set(newTitle, newDetail, done, total) {
      title.textContent = newTitle;
      detail.textContent = newDetail;
      bar.style.width = `${total === 0 ? 100 : Math.round((done / total) * 100)}%`;
      count.textContent = `${done} de ${total}`;
    },
    finish(newTitle, newDetail) {
      finished = true;
      title.textContent = newTitle;
      detail.textContent = newDetail;
      button.disabled = false;
      button.textContent = 'Cerrar';
      button.className = 'close';
    },
    stopRequested: () => stop,
  };
}

// ───────────────────────── ejecución ─────────────────────────

function challengeVisible(): boolean {
  return (
    document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="challenges.cloudflare"], #challenge-form, #px-captcha') !== null ||
    /captcha|just a moment|verif(y|ica)/i.test(document.title)
  );
}

/** Ejecuta un paso. En simulación no toca Vinted. */
async function perform(step: Extract<CommandStep, { action: 'do' }>): Promise<StepResult> {
  if (challengeVisible()) {
    return { index: step.index, ok: false, stop: true, error: 'Vinted pide una verificación o captcha.' };
  }
  if (!step.dry_run) {
    return { index: step.index, ok: false, stop: true, error: REAL_WRITES_DISABLED };
  }
  await sleep(700);
  return { index: step.index, ok: true };
}

const FINAL_TITLES: Record<string, string> = {
  done: 'Terminado',
  failed: 'Detenido por un error',
  cancelled: 'Parado',
};

export async function runCommand(command: CommandInfo): Promise<void> {
  if (running) return;
  running = true;
  const overlay = createOverlay(command);
  const what = command.type === 'send_offers' ? 'Ofertas a favoritos' : 'Bajada de precios';
  overlay.set(what, 'Preparando…', 0, command.total);

  try {
    let last: StepResult | undefined;
    for (;;) {
      if (overlay.stopRequested()) {
        await ask({ kind: 'command-cancel', id: command.id });
        overlay.finish('Parado', 'Has pulsado PARAR. No se ejecuta nada más.');
        return;
      }

      const step = await ask<CommandStep | { action: 'error'; message: string }>({ kind: 'command-step', id: command.id, last });
      last = undefined;

      if (step.action === 'error') {
        overlay.finish('Sin conexión con ResellPilot', step.message);
        return;
      }
      if (step.action === 'finished') {
        overlay.finish(FINAL_TITLES[step.status] ?? 'Terminado', step.error ?? 'Mira el registro completo en el dashboard.');
        return;
      }
      if (step.action === 'wait') {
        // Cuenta atrás en trozos de 1 s para que PARAR responda al instante.
        for (let left = step.seconds; left > 0 && !overlay.stopRequested(); left--) {
          overlay.set(what, `Esperando ${left} s antes del siguiente…`, step.done, step.total);
          await sleep(1000);
        }
        continue;
      }

      const verb = step.kind === 'message' ? (step.dry_run ? 'Simulando mensaje a' : 'Enviando mensaje a') : step.dry_run ? 'Simulando bajada de' : 'Bajando precio de';
      overlay.set(what, `${verb} ${step.label}`, step.done, step.total);
      last = await perform(step);
    }
  } catch {
    overlay.finish('Interrumpido', 'Se perdió la conexión con la extensión. Recarga la pestaña y revisa el dashboard.');
  } finally {
    running = false;
  }
}
