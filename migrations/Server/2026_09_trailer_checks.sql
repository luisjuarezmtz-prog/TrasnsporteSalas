-- =====================================================================
-- Migración: Check de Unidad (Tracto Camión) — FORM-CTC-01
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Es el equivalente del Check de Caja Seca (`checks`) pero para el
-- tracto, que es un activo distinto. No se reutiliza `checks` porque:
--   * los puntos a revisar van agrupados POR VISTA (el de caja tiene
--     una lista plana de componentes), y
--   * el tracto no tiene piso ni la tabla de posiciones de llantas de
--     la caja, pero sí operador y origen/destino.
--
-- Contenido:
--   1. `trailer_checks`: encabezado (fecha, unidad, operador, ruta,
--      estado general y observaciones).
--   2. `trailer_check_componentes`: un renglón por punto revisado, con
--      su vista y su estado BUENO/REGULAR/MALO.
--   3. `trailer_check_marcas_dano`: marcas georreferenciadas sobre los
--      diagramas, mismo esquema que `marcas_dano` del check de caja.
--
-- ID_TRAILER es opcional a propósito: permite levantar el check de una
-- unidad que todavía no está en el registro de tráileres. Cuando sí
-- está, UNIDAD_PLACAS guarda la copia del dato para que el histórico no
-- cambie si después se corrigen las placas en el catálogo.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Encabezado del check ----------------------------------------------
CREATE TABLE IF NOT EXISTS trailer_checks (
  ID_CHECK         INT AUTO_INCREMENT PRIMARY KEY,
  ID_TRAILER       INT NULL,
  FECHA            DATE NOT NULL,
  UNIDAD_PLACAS    VARCHAR(30),
  OPERADOR         VARCHAR(150),
  ORIGEN_DESTINO   VARCHAR(200),
  ESTADO_GENERAL   VARCHAR(20),
  OBSERVACIONES    TEXT,
  USUARIO          VARCHAR(30),
  CREATION_DATE    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATE_DATE      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_trailer_check_trailer (ID_TRAILER),
  KEY idx_trailer_check_fecha (FECHA),
  FOREIGN KEY (ID_TRAILER) REFERENCES trailers(ID_TRAILER)
);

-- 2) Puntos revisados, agrupados por vista -----------------------------
CREATE TABLE IF NOT EXISTS trailer_check_componentes (
  ID_COMPONENTE    INT AUTO_INCREMENT PRIMARY KEY,
  ID_CHECK         INT NOT NULL,
  VISTA            VARCHAR(30) NOT NULL,
  COMPONENTE       VARCHAR(80) NOT NULL,
  ESTADO           VARCHAR(10),
  OBSERVACIONES    VARCHAR(255),
  KEY idx_trailer_check_comp (ID_CHECK),
  FOREIGN KEY (ID_CHECK) REFERENCES trailer_checks(ID_CHECK) ON DELETE CASCADE
);

-- 3) Marcas de daño sobre los diagramas --------------------------------
CREATE TABLE IF NOT EXISTS trailer_check_marcas_dano (
  ID_MARCA         INT AUTO_INCREMENT PRIMARY KEY,
  ID_CHECK         INT NOT NULL,
  VISTA            VARCHAR(30) NOT NULL,
  POS_X            DECIMAL(6,3) NOT NULL,
  POS_Y            DECIMAL(6,3) NOT NULL,
  TIPO_DANO        VARCHAR(20) NOT NULL,
  DESCRIPCION      VARCHAR(255),
  CREATION_DATE    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_trailer_check_marca (ID_CHECK),
  FOREIGN KEY (ID_CHECK) REFERENCES trailer_checks(ID_CHECK) ON DELETE CASCADE
);

-- 4) Submódulo dentro del grupo Flotilla --------------------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'checktracto', 'Check de Tracto', 30
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'checktracto';
