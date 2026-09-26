-- =====================================================================
-- Migración: Fecha de pago y comprobante de pago en Mantenimientos
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Concluir una orden y pagarla son dos momentos distintos: el taller
-- puede entregar el trabajo el día 10 y cobrarse el día 30. Antes solo
-- se guardaba FECHA_CONCLUSION, así que no había forma de saber qué
-- órdenes ya se pagaron.
--
--   * mantenimientos.FECHA_PAGO -> cuándo se liquidó la orden.
--   * mantenimiento_documentos.TIPO_DOCUMENTO -> distingue la factura
--     del taller del comprobante de pago. Antes la tabla era una lista
--     sin tipo y no se podía saber cuál archivo era cuál.
--
-- Los documentos que ya existan quedan como 'FACTURA', que es lo que se
-- estaba subiendo hasta ahora.
--
-- Es seguro volver a correrlo (chequeo de information_schema antes de
-- cada ALTER).
-- =====================================================================

-- 1) mantenimientos.FECHA_PAGO -----------------------------------------
SET @col_fecha_pago = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mantenimientos' AND COLUMN_NAME = 'FECHA_PAGO'
);
SET @sql_fecha_pago = IF(@col_fecha_pago = 0,
  'ALTER TABLE mantenimientos ADD COLUMN FECHA_PAGO DATE NULL AFTER FECHA_CONCLUSION',
  'SELECT ''mantenimientos.FECHA_PAGO ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_fecha_pago FROM @sql_fecha_pago;
EXECUTE stmt_fecha_pago;
DEALLOCATE PREPARE stmt_fecha_pago;

-- 2) mantenimiento_documentos.TIPO_DOCUMENTO ---------------------------
SET @col_tipo_doc = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mantenimiento_documentos' AND COLUMN_NAME = 'TIPO_DOCUMENTO'
);
SET @sql_tipo_doc = IF(@col_tipo_doc = 0,
  'ALTER TABLE mantenimiento_documentos ADD COLUMN TIPO_DOCUMENTO VARCHAR(25) NOT NULL DEFAULT ''FACTURA'' AFTER ID_MANTENIMIENTO',
  'SELECT ''mantenimiento_documentos.TIPO_DOCUMENTO ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_tipo_doc FROM @sql_tipo_doc;
EXECUTE stmt_tipo_doc;
DEALLOCATE PREPARE stmt_tipo_doc;
