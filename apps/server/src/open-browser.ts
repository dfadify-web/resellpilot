import { exec } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Abre la URL en el navegador por defecto, una sola vez por sesión de `pnpm dev`:
 * `tsx watch` reinicia este proceso en cada cambio, pero el proceso padre es el mismo.
 */
export function openBrowserOnce(url: string): void {
  const marker = join(tmpdir(), `resellpilot-dev-${process.ppid}`);
  if (existsSync(marker)) return;
  try {
    writeFileSync(marker, String(Date.now()));
  } catch {
    return;
  }
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {
    // Si no se puede abrir el navegador, la URL ya está en la consola.
  });
}
