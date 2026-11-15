import type { WeeklyReport } from '@resellpilot/shared';
import { Download, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, describeError, weeklyCsvUrl, type DailyReportResponse, type WeeklyReportsResponse } from '../api';
import { pct, signedEur } from '../format';
import { ui } from '../ui';
import { Card, CardHeader } from './kit';

const dayMonth = (key: string): string => {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
};

function Week({ label, report }: { label: string; report: WeeklyReport }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-sunken px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted">
          {dayMonth(report.monday)} – {dayMonth(report.sunday)} · {report.sales === 1 ? '1 venta' : `${report.sales} ventas`}
          {report.roi !== null && ` · ROI ${pct(report.roi)}`}
        </p>
      </div>
      <p className={`${ui.num} text-2xl ${report.profit > 0 ? 'text-accent' : ''}`}>
        {report.sales === 0 ? '—' : signedEur(report.profit)}
      </p>
      <a
        className="grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface text-muted transition hover:text-ink"
        href={weeklyCsvUrl(report.monday)}
        download
        aria-label={`Descargar CSV de ${label.toLowerCase()}`}
        title="Descargar CSV para Excel"
      >
        <Download size={16} aria-hidden="true" />
      </a>
    </div>
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {weekly && (
        <Card>
          <CardHeader
            illustration="informe"
            title="Informe semanal"
            description="De lunes a domingo. El CSV se abre en Excel: una fila por venta y el total al final."
          />
          <div className="space-y-2.5 p-5">
            <Week label="Esta semana" report={weekly.current} />
            <Week label="Semana pasada" report={weekly.previous} />
          </div>
        </Card>
      )}

      {daily && (
        <Card>
          <CardHeader
            illustration="resumen-diario"
            title="Resumen diario"
            description="Así te llega a Telegram cada mañana a las 08:30."
          />
          <div className="p-5">
            <pre className="scroll-soft max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-sunken px-4 py-3 font-sans text-[13px] leading-relaxed">
              {daily.text}
            </pre>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className={ui.secondary} disabled={sending || !daily.telegram} onClick={() => void send()}>
                <Send size={15} aria-hidden="true" />
                {sending ? 'Enviando…' : 'Enviar ahora'}
              </button>
              <p role="status" className="text-xs text-muted">
                {notice ??
                  (!daily.telegram
                    ? 'Falta el token del bot en .env: sin él no hay avisos.'
                    : daily.sent_today
                      ? 'El de hoy ya se ha enviado.'
                      : 'Si el equipo estaba apagado a las 08:30, llega al arrancar.')}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
