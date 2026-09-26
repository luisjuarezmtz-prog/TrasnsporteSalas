-- =====================================================================
-- Migración: Póliza digitalizada + Panel de Vencimientos
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- 1. `trailer_seguro_documentos`: la póliza escaneada y sus anexos
--    (endosos, recibos de pago). Se guarda como lista y no como una
--    sola columna de archivo, porque una póliza casi siempre acumula
--    documentos a lo largo de su vigencia.
--
-- 2. Submódulo del panel de vencimientos. El panel no crea tablas
--    nuevas: cruza las fechas que ya viven en los módulos existentes
--    (tarjeta de circulación, verificación físico-mecánica, pólizas,
--    pagos de póliza y gestorías que renuevan un documento). Todas esas
--    columnas ya quedaron indexadas en sus migraciones.
--
-- Es seguro volver a correrlo.
-- =====================================================================

-- 1) Documentos de la póliza --------------------------------------------
CREATE TABLE IF NOT EXISTS trailer_seguro_documentos (
  ID_DOCUMENTO   INT AUTO_INCREMENT PRIMARY KEY,
  ID_SEGURO      INT NOT NULL,
  FILE_PATH      VARCHAR(255) NOT NULL,
  FILE_NAME      VARCHAR(255) NOT NULL,
  UPLOAD_DATE    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_seguro_doc (ID_SEGURO),
  FOREIGN KEY (ID_SEGURO) REFERENCES trailer_seguros(ID_SEGURO) ON DELETE CASCADE
);

-- 2) Submódulo del panel de vencimientos ---------------------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'vencimientos', 'Vencimientos', 60
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'vencimientos';
