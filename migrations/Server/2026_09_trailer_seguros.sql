-- =====================================================================
-- Migración: Seguros del tráiler
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Requisito del cliente:
--   * El seguro se captura con su valor total, el plazo en meses y la
--     fecha del primer pago.
--   * El PRIMER PAGO se captura a mano (suele ser un enganche distinto)
--     y lo que resta se amortiza en partes iguales entre los meses que
--     quedan. El plan se calcula en utils/amortizacionSeguro.js y se
--     guarda renglón por renglón en `trailer_seguro_pagos`.
--   * SIN PROVEEDOR NO SE PUEDE REGISTRAR EL SEGURO: por eso
--     ID_PROVEEDOR es NOT NULL con llave foránea al catálogo que ya
--     existe, no un campo de texto libre.
--
-- FECHA_VENCIMIENTO es la vigencia de la póliza y queda indexada para
-- el panel de vencimientos.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Póliza --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trailer_seguros (
  ID_SEGURO           INT AUTO_INCREMENT PRIMARY KEY,
  ID_TRAILER          INT NOT NULL,
  ID_PROVEEDOR        INT NOT NULL,
  NUMERO_POLIZA       VARCHAR(60),
  VALOR_SEGURO        DECIMAL(12,2) NOT NULL,
  PLAZO_MESES         INT NOT NULL,
  PRIMER_PAGO         DECIMAL(12,2) NOT NULL DEFAULT 0,
  FECHA_PRIMER_PAGO   DATE NOT NULL,
  FECHA_INICIO        DATE,
  FECHA_VENCIMIENTO   DATE,
  ESTATUS             TINYINT(1) NOT NULL DEFAULT 1,
  OBSERVACIONES       TEXT,
  USUARIO             VARCHAR(30),
  CREATION_DATE       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATE_DATE         TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_seguro_trailer (ID_TRAILER),
  KEY idx_seguro_proveedor (ID_PROVEEDOR),
  KEY idx_seguro_vencimiento (FECHA_VENCIMIENTO),
  FOREIGN KEY (ID_TRAILER) REFERENCES trailers(ID_TRAILER),
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR)
);

-- 2) Plan de pagos -------------------------------------------------------
-- NUMERO_PAGO = 1 es siempre el primer pago capturado a mano.
CREATE TABLE IF NOT EXISTS trailer_seguro_pagos (
  ID_PAGO             INT AUTO_INCREMENT PRIMARY KEY,
  ID_SEGURO           INT NOT NULL,
  NUMERO_PAGO         INT NOT NULL,
  FECHA_PROGRAMADA    DATE NOT NULL,
  MONTO               DECIMAL(12,2) NOT NULL,
  PAGADO              TINYINT(1) NOT NULL DEFAULT 0,
  FECHA_PAGO          DATE NULL,
  OBSERVACIONES       VARCHAR(255),
  UNIQUE KEY uq_seguro_numero_pago (ID_SEGURO, NUMERO_PAGO),
  KEY idx_pago_programada (FECHA_PROGRAMADA),
  FOREIGN KEY (ID_SEGURO) REFERENCES trailer_seguros(ID_SEGURO) ON DELETE CASCADE
);

-- 3) Submódulo dentro del grupo Flotilla ---------------------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'segurostrailer', 'Seguros de Tráiler', 40
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'segurostrailer';
