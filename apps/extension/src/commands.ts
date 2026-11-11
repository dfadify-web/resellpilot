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
             background: #0a0a0b; color: #ecece7; border: 1px solid #27272b; border-top: 3px solid #ff4b1f;
             font: 13px/1.4 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 14px 16px; }
      .brand { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; color: #85858f; }
      .brand b { color: #ff4b1f; }
      .tag { float: right; background: #ff4b1f; color: #0a0a0b; font-weight: 700; font-size: 10px; padding: 1px 6px; letter-spacing: .1em; }
      .title { margin-top: 8px; font-size: 16px; font-weight: 700; }
      .detail { margin-top: 4px; color: #85858f; min-height: 36px; overflow-wrap: anywhere; }
      .bar { margin-top: 10px; height: 4px; background: #27272b; }
      .bar i { display: block; height: 4px; width: 0; background: #ff4b1f; }
      .count { margin-top: 6px; font-variant-numeric: tabular-nums; color: #85858f; font-size: 11px; }
      button { margin-top: 12px; width: 100%; padding: 10px; border: 0; cursor: pointer; background: #ff4b1f; color: #0a0a0b;
               font: 700 15px/1 'Arial Narrow', 'Helvetica Neue', sans-serif; letter-spacing: .08em; text-transform: uppercase; }
      button.close { background: none; color: #ecece7; border: 1px solid #27272b; }
      button:focus-visible { outline: 2px solid #ecece7; outline-offset: 2px; }
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
