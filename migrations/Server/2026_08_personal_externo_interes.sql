-- =====================================================================
-- Migración: Interés sobre préstamos de Personal Externo
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- Personal Externo no tiene nómina, así que no hay un punto donde
-- calcular el interés como en revisarnomina.html (3% del saldo
-- restante, guardado como renglón informativo en payroll.INTERESES).
-- Aquí el interés SÍ se suma al saldo del préstamo: cada vez que se
-- registra un abono (routes/prestamosExterno.js, POST
-- /prestamos-externos/:id/abono), primero se le suma el 3% de interés
-- al saldo pendiente y luego se resta el monto abonado. Se agrega la
-- columna INTERES a abono_prestamos_externos para dejar registro de
-- cuánto interés se aplicó en cada evento (auditoría/consulta).
--
-- Es seguro volver a correrlo (chequeo de information_schema antes del
-- ALTER).
-- =====================================================================

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'abono_prestamos_externos' AND COLUMN_NAME = 'INTERES'
);
SET @sql_interes = IF(@col_exists = 0,
  'ALTER TABLE abono_prestamos_externos ADD COLUMN INTERES INT NOT NULL DEFAULT 0 AFTER MONTO_ABONO',
  'SELECT ''abono_prestamos_externos.INTERES ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_interes FROM @sql_interes;
EXECUTE stmt_interes;
DEALLOCATE PREPARE stmt_interes;
