import { ORDER_STATE_LABELS, type OrderState, type OrderView } from '@resellpilot/shared';
import { ExternalLink, PackageCheck, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { eur, shortDate } from '../format';
import { ui } from '../ui';
import { Badge, Card, CardHeader, Thumb, type BadgeTone } from './kit';

const STATE_TONES: Record<OrderState, BadgeTone> = {
  enviar: 'pinkSolid',
  en_curso: 'outline',
  completado: 'accent',
  cancelado: 'pink',
};

const REFRESH_MS = 60_000;

/** Carga los pedidos vendidos y los refresca cada minuto. */
function useOrders(): OrderView[] | null {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listOrders()
        .then((rows) => alive && setOrders(rows))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return orders;
}

function OpenInVinted({ url, label = 'Abrir en Vinted' }: { url: string | null; label?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className={`${ui.secondary} h-9 px-4`}>
      <ExternalLink size={14} aria-hidden="true" />
      {label}
    </a>
  );
}

/** Aviso destacado: pedidos vendidos que hay que enviar. No se muestra si no hay ninguno. */
export function ToShipBanner({ orders }: { orders: OrderView[] }) {
  const toShip = orders.filter((order) => order.state === 'enviar');
  if (toShip.length === 0) return null;
  return (
    <section className="animate-rise overflow-hidden rounded-[var(--radius-card)] border border-pink/40 bg-pink-soft shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3 px-5 pt-5">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-pink-ink text-white">
          <Truck size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">
            {toShip.length === 1 ? 'Tienes 1 pedido por enviar' : `Tienes ${toShip.length} pedidos por enviar`}
          </h2>
          <p className="text-[13px] text-muted">Imprime la etiqueta en la conversación del pedido y llévalo al punto de envío.</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-pink/20 border-t border-pink/20">
        {toShip.map((order) => (
          <li key={order.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
            <Thumb src={order.photo} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{order.title}</p>
              <p className="text-xs text-muted">
                Vendido el {shortDate(order.at)} por {eur(order.price)}
                {order.status_text && ` · ${order.status_text}`}
              </p>
            </div>
            <OpenInVinted url={order.url} label="Ver pedido" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lista de pedidos vendidos en Vinted con su estado. */
export function OrdersCard({ orders }: { orders: OrderView[] }) {
  if (orders.length === 0) return null;
  const shown = orders.slice(0, 8);
  return (
    <Card as="section">
      <CardHeader
        icon={PackageCheck}
        title="Pedidos en Vinted"
        description="Ventas reales con su precio final (con ofertas y lotes) y su estado. Si el anuncio está enlazado, el inventario se actualiza solo."
      />
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {shown.map((order) => (
          <li key={order.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
            <Thumb src={order.photo} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{order.title}</p>
              <p className="text-xs text-muted">
                {shortDate(order.at)}
                {order.item_name ? ` · inventario: ${order.item_name}` : ' · sin enlazar al inventario'}
              </p>
            </div>
            <p className={`${ui.num} text-lg`}>{eur(order.price)}</p>
            <Badge tone={STATE_TONES[order.state]} title={order.status_text ?? undefined}>
              {ORDER_STATE_LABELS[order.state]}
            </Badge>
            {order.url && (
              <a href={order.url} target="_blank" rel="noreferrer noopener" className="text-faint transition hover:text-accent" aria-label={`Abrir el pedido «${order.title}» en Vinted`}>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            )}
          </li>
        ))}
      </ul>
      {orders.length > shown.length && <p className="border-t border-line px-5 py-3 text-xs text-muted">…y {orders.length - shown.length} pedidos más.</p>}
    </Card>
  );
}

export { useOrders };
