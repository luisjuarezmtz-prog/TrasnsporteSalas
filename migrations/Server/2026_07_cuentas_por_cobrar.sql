-- =====================================================================
-- Migración: Módulo de Cuentas por Cobrar (CXC) — cálculo de factura
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- Qué hace este script:
--   1. Agrega el grupo de menú "Cuentas por Cobrar" (grupo-cxc) al
--      catálogo de módulos, con 2 submódulos:
--        - cxcmovimientos: consulta de movimientos de viajes (rango de
--          fechas) sobre travels_movements.
--        - cxcfacturas: pantalla donde se genera la factura (rango de
--          movimientos + fecha de pago general de locales/foráneos) y
--          se guarda/consulta el historial.
--   2. Da acceso a todo por default a todos los roles existentes (mismo
--      criterio que los demás módulos: nadie pierde acceso a nada).
--   3. Crea `cxc_facturas`: una fila por cada factura generada y
--      guardada, con el desglose agregado (movimientos, locales,
--      foráneos) y los totales con IVA.
--   4. Crea `cxc_facturas_foraneos_detalle`: el desglose por CEDI de la
--      parte de foráneos de cada factura (una factura puede combinar
--      varios cedis foráneos), ya que la cantidad de cedis es variable.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Módulo y submódulos en el menú -------------------------------------
INSERT IGNORE INTO c_system_modules (MODULE_KEY, MODULE_LABEL, ORDEN)
VALUES ('grupo-cxc', 'Cuentas por Cobrar', 45);

INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'cxcmovimientos', 'Movimiento de Viajes', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-cxc'
UNION ALL SELECT ID_MODULE, 'cxcfacturas', 'Factura CXC', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-cxc';

-- 2) Todos los roles existentes conservan acceso a todo por default -----
INSERT IGNORE INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
SELECT r.ID_ROLE, m.ID_MODULE, 1
FROM c_roles r
CROSS JOIN c_system_modules m
WHERE m.MODULE_KEY = 'grupo-cxc';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s
WHERE s.SUBMODULE_KEY IN ('cxcmovimientos', 'cxcfacturas');

-- 3) Facturas de Cuentas por Cobrar --------------------------------------
CREATE TABLE IF NOT EXISTS cxc_facturas (
  ID_FACTURA                 INT AUTO_INCREMENT PRIMARY KEY,
  FOLIO                      VARCHAR(30) NOT NULL UNIQUE,
  FECHA_INICIO_MOVIMIENTOS   DATE NOT NULL,
  FECHA_FIN_MOVIMIENTOS      DATE NOT NULL,
  FECHA_PAGO_GENERAL         DATE NOT NULL,
  NUM_MOVIMIENTOS            INT NOT NULL DEFAULT 0,
  MONTO_MOVIMIENTOS          DECIMAL(12,2) NOT NULL DEFAULT 0,
  NUM_LOCALES                INT NOT NULL DEFAULT 0,
  MONTO_LOCALES              DECIMAL(12,2) NOT NULL DEFAULT 0,
  NUM_FORANEOS                INT NOT NULL DEFAULT 0,
  MONTO_FORANEOS             DECIMAL(12,2) NOT NULL DEFAULT 0,
  SUBTOTAL                   DECIMAL(12,2) NOT NULL DEFAULT 0,
  IVA                        DECIMAL(12,2) NOT NULL DEFAULT 0,
  IVA_RETENIDO               DECIMAL(12,2) NOT NULL DEFAULT 0,
  TOTAL_FACTURA               DECIMAL(12,2) NOT NULL DEFAULT 0,
  ID_STATUS                  TINYINT NOT NULL DEFAULT 1,  -- 1=Generada, 2=Pagada, 3=Cancelada
  USERNAME                   VARCHAR(50),
  CREATION_DATE               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4) Desglose por CEDI de la parte de foráneos de cada factura -----------
CREATE TABLE IF NOT EXISTS cxc_facturas_foraneos_detalle (
  ID_DETALLE   INT AUTO_INCREMENT PRIMARY KEY,
  ID_FACTURA   INT NOT NULL,
  CEDI_NAME    VARCHAR(100) NOT NULL,
  NUMERO       INT NOT NULL DEFAULT 0,
  COSTO        DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (ID_FACTURA) REFERENCES cxc_facturas(ID_FACTURA)
);
