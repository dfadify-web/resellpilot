-- Fase 4: distingue el precio de venta estimado escrito a mano del calculado por Tendencias.
-- Solo los deals con est_manual = 0 reciben el precio estimado automático.

ALTER TABLE deals ADD COLUMN est_manual INTEGER NOT NULL DEFAULT 0 CHECK (est_manual IN (0, 1));
UPDATE deals SET est_manual = 1 WHERE est_price IS NOT NULL;
