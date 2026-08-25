-- =====================================================================
-- Migración: Abonos de Caja de Ahorro de Personal Externo
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- caja_ahorro_externo (igual que caja_ahorro de empleados) es un solo
-- registro por persona/año con un "monto" fijo. Eso sirve para
-- empleados porque ese monto se descuenta solo en cada corrida de
-- nómina (routes/nomina.js), pero Personal Externo no tiene nómina, así
-- que no hay dónde ir acumulando cuánto se ha abonado realmente.
--
-- Esta migración agrega un ledger (caja_ahorro_externo_abonos) para
-- registrar cada aportación manual, igual patrón que
-- abono_prestamos_externos: un registro por evento, y el total
-- abonado se calcula sumando esos registros (rutas nuevas en
-- routes/cajaAhorroExterno.js).
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS caja_ahorro_externo_abonos (
  ID_ABONO                 INT AUTO_INCREMENT PRIMARY KEY,
  ID_CAJA_AHORRO_EXTERNO   INT NOT NULL,
  MONTO_ABONO               INT NOT NULL,
  USUARIO                   VARCHAR(30),
  FECHA_CREACION             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_CAJA_AHORRO_EXTERNO) REFERENCES caja_ahorro_externo(id_caja_ahorro_externo)
);
