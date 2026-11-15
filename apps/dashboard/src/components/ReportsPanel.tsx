import type { WeeklyReport } from '@resellpilot/shared';
import { useEffect, useState } from 'react';
import { api, describeError, weeklyCsvUrl, type DailyReportResponse, type WeeklyReportsResponse } from '../api';
import { pct, signedEur } from '../format';
import { ui } from '../ui';

const dayMonth = (key: string): string => {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
};

function WeekRow({ label, report }: { label: string; report: WeeklyReport }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className={ui.th}>
        {label}
        <span className="block normal-case tracking-normal">
          {dayMonth(report.monday)} – {dayMonth(report.sunday)}
        </span>
      </th>
      <td className={`${ui.td} text-right`}>{report.sales}</td>
      <td className={`${ui.td} text-right font-semibold ${report.profit > 0 ? 'text-accent' : ''}`}>
        {report.sales === 0 ? '—' : signedEur(report.profit)}
      </td>
      <td className={`${ui.td} text-right`}>{pct(report.roi)}</td>
      <td className={`${ui.td} text-right`}>
        <a className={`${ui.link} text-paper`} href={weeklyCsvUrl(report.monday)} download>
          Descargar
        </a>
      </td>
    </tr>
  );
}

/** Informe semanal de beneficios (CSV) y resumen diario de Telegram, en Resumen. */
export function ReportsPanel() {
  const [weekly, setWeekly] = useState<WeeklyReportsResponse | null>(null);
  const [daily, setDaily] = useState<DailyReportResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.weeklyReports().then((data) => alive && setWeekly(data)).catch(() => undefined);
    api.dailyReport().then((data) => alive && setDaily(data)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function send() {
    setSending(true);
    setNotice(null);
    try {
      const result = await api.sendDailyReport();
      setNotice(result.ok ? 'Resumen enviado a Telegram.' : (result.error ?? 'Telegram rechazó el mensaje.'));
      if (result.ok) setDaily((current) => current && { ...current, sent_today: true });
    } catch (error) {
      setNotice(describeError(error).message);
    } finally {
      setSending(false);
    }
  }

  if (!weekly && !daily) return null;

  return (
    <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-2">
      {weekly && (
        <div>
          <h2 className="font-display text-3xl font-bold uppercase">Informe semanal</h2>
          <div className="mt-3 overflow-x-auto border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-line bg-panel">
                <tr>
                  <th className={ui.th}>Semana</th>
                  <th className={`${ui.th} text-right`}>Ventas</th>
                  <th className={`${ui.th} text-right`}>Beneficio</th>
                  <th className={`${ui.th} text-right`}>ROI</th>
                  <th className={`${ui.th} text-right`}>CSV</th>
                </tr>
              </thead>
              <tbody>
                <WeekRow label="Esta semana" report={weekly.current} />
                <WeekRow label="Semana pasada" report={weekly.previous} />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">De lunes a domingo. El CSV se abre en Excel: una fila por venta y el total al final.</p>
        </div>
      )}

      {daily && (
        <div>
          <h2 className="font-display text-3xl font-bold uppercase">Resumen diario</h2>
          <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap border border-line bg-panel px-4 py-3 font-sans text-sm">
            {daily.text}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button type="button" className={ui.secondary} disabled={sending || !daily.telegram} onClick={() => void send()}>
              {sending ? 'Enviando…' : 'Enviar ahora a Telegram'}
            </button>
            <p role="status" className="text-xs text-muted">
              {notice ??
                (!daily.telegram
                  ? 'Falta el token del bot en .env: sin él no hay avisos.'
                  : daily.sent_today
                    ? 'El de hoy ya se ha enviado. Llega solo cada día a las 08:30.'
                    : 'Llega solo cada día a las 08:30 (o al arrancar, si el equipo estaba apagado).')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
