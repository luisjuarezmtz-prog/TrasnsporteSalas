-- =====================================================================
-- Migración: Puntos realizados por orden + comparativo de servicios
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Hasta ahora una orden solo tenía una DESCRIPCION de texto libre, así
-- que no había manera de saber QUÉ se hizo exactamente ni de comparar
-- una orden contra otra. El cliente necesita registrar todos los puntos
-- que se realizaron en cada servicio y poder revisar por qué a una
-- misma unidad se le han hecho tantos servicios del mismo tipo.
--
-- `mantenimiento_detalle` es una LISTA, no un checklist: los puntos no
-- salen de un catálogo fijo que se palomea, se capturan renglón por
-- renglón. Dos razones: el trabajo de taller varía demasiado para
-- encasillarlo en una lista cerrada, y para el comparativo interesa el
-- texto de lo que realmente se hizo, no un booleano.
--
-- ORDEN conserva la secuencia de captura, para que el comparativo
-- muestre los puntos en el mismo orden en que los anotó el mecánico.
--
-- Es seguro volver a correrlo.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mantenimiento_detalle (
  ID_DETALLE        INT AUTO_INCREMENT PRIMARY KEY,
  ID_MANTENIMIENTO  INT NOT NULL,
  ORDEN             INT NOT NULL DEFAULT 0,
  DESCRIPCION       VARCHAR(255) NOT NULL,
  CANTIDAD          DECIMAL(10,2) NOT NULL DEFAULT 1,
  COSTO             DECIMAL(12,2) NULL,
  OBSERVACIONES     VARCHAR(255),
  CREATION_DATE     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_detalle_mantenimiento (ID_MANTENIMIENTO),
  -- El comparativo agrupa por texto del punto, así que conviene tenerlo
  -- indexado (prefijo: 255 caracteres completos no caben en la clave).
  KEY idx_detalle_descripcion (DESCRIPCION(80)),
  FOREIGN KEY (ID_MANTENIMIENTO) REFERENCES mantenimientos(ID_MANTENIMIENTO) ON DELETE CASCADE
);

-- Submódulo del comparativo, dentro del grupo Flotilla ------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'comparativomantenimientos', 'Comparativo de Servicios', 55
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'comparativomantenimientos';
