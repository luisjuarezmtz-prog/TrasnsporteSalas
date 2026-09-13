-- =====================================================================
-- Migración: Periodicidad y tasa de interés por préstamo (Personal Externo)
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Hasta ahora todos los préstamos de Personal Externo usaban una tasa
-- fija del 3% que se aplicaba una sola vez al registrar un abono
-- (ver 2026_08_personal_externo_interes.sql). El cliente ahora necesita
-- pactar cada préstamo por separado:
--
--   * PERIODICIDAD  -> 'SEMANAL' o 'MENSUAL': cada cuánto se devenga el
--                      interés. El saldo crece solo con el paso del
--                      tiempo, no únicamente al abonar.
--   * TASA_INTERES  -> 3.00 o 10.00 (porcentaje por periodo).
--
-- En abono_prestamos_externos se agrega PERIODOS para dejar registro de
-- cuántos periodos de interés cubrió cada abono (auditoría: con INTERES
-- y PERIODOS se puede reconstruir el cálculo exacto).
--
-- Los préstamos que ya existen quedan con los valores DEFAULT
-- ('SEMANAL', 3.00), que es el comportamiento que tenían.
--
-- Es seguro volver a correrlo (chequeo de information_schema antes de
-- cada ALTER).
-- =====================================================================

-- 1) reg_prestamos_externos.PERIODICIDAD -------------------------------
SET @col_periodicidad = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reg_prestamos_externos' AND COLUMN_NAME = 'PERIODICIDAD'
);
SET @sql_periodicidad = IF(@col_periodicidad = 0,
  'ALTER TABLE reg_prestamos_externos ADD COLUMN PERIODICIDAD VARCHAR(10) NOT NULL DEFAULT ''SEMANAL'' AFTER MONTO_PRESTAMO',
  'SELECT ''reg_prestamos_externos.PERIODICIDAD ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_periodicidad FROM @sql_periodicidad;
EXECUTE stmt_periodicidad;
DEALLOCATE PREPARE stmt_periodicidad;

-- 2) reg_prestamos_externos.TASA_INTERES -------------------------------
SET @col_tasa = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reg_prestamos_externos' AND COLUMN_NAME = 'TASA_INTERES'
);
SET @sql_tasa = IF(@col_tasa = 0,
  'ALTER TABLE reg_prestamos_externos ADD COLUMN TASA_INTERES DECIMAL(5,2) NOT NULL DEFAULT 3.00 AFTER PERIODICIDAD',
  'SELECT ''reg_prestamos_externos.TASA_INTERES ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_tasa FROM @sql_tasa;
EXECUTE stmt_tasa;
DEALLOCATE PREPARE stmt_tasa;

-- 3) abono_prestamos_externos.PERIODOS ---------------------------------
SET @col_periodos = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'abono_prestamos_externos' AND COLUMN_NAME = 'PERIODOS'
);
SET @sql_periodos = IF(@col_periodos = 0,
  'ALTER TABLE abono_prestamos_externos ADD COLUMN PERIODOS INT NOT NULL DEFAULT 0 AFTER INTERES',
  'SELECT ''abono_prestamos_externos.PERIODOS ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_periodos FROM @sql_periodos;
EXECUTE stmt_periodos;
DEALLOCATE PREPARE stmt_periodos;
