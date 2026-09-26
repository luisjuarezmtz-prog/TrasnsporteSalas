-- =====================================================================
-- Migración: Registro de Tráileres (Flotilla)
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- El tráiler (tractocamión) y la caja seca son activos DISTINTOS. La
-- caja ya se maneja en el Check de Caja Seca (tabla `checks`), que trae
-- su propia copia de los datos de la tarjeta de circulación de la caja.
-- Esta migración NO toca esa tabla: crea el registro del tráiler como
-- módulo aparte, con su propia tarjeta de circulación.
--
-- Contenido:
--   1. `trailers`: ficha del tractocamión con los datos de la Tarjeta de
--      Circulación del SICT (Servicio de Autotransporte Federal).
--   2. `c_document_types_trailer` + `trailer_documents`: documentos
--      escaneados, mismo patrón que empleados / personal externo /
--      proveedores.
--   3. `trailer_verificaciones`: Dictamen de Verificación de Condiciones
--      Físico-Mecánicas (NOM-068-SCT-2-2014). Es periódico -- el propio
--      dictamen registra la fecha de la verificación anterior -- así que
--      va en tabla aparte para conservar el histórico, no como columnas
--      de la ficha.
--
-- Las fechas que vencen (FECHA_LIMITE_SUSTITUCION de la tarjeta y
-- FECHA_VIGENCIA de la verificación) quedan indexadas desde ahora para
-- que el panel de vencimientos las consulte sin escaneo completo.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Ficha del tráiler: Tarjeta de Circulación -------------------------
CREATE TABLE IF NOT EXISTS trailers (
  ID_TRAILER              INT AUTO_INCREMENT PRIMARY KEY,
  STATUS                  TINYINT(1) NOT NULL DEFAULT 1,

  -- Identificación interna
  NO_ECONOMICO            VARCHAR(30),
  PLACAS                  VARCHAR(20) NOT NULL,

  -- Titular / propietario
  RAZON_SOCIAL            VARCHAR(150),
  RFC                     VARCHAR(13),
  PROPIETARIO_VEHICULO    VARCHAR(150),

  -- Domicilio del titular
  DOMICILIO_CALLE         VARCHAR(120),
  DOMICILIO_NUMERO        VARCHAR(20),
  DOMICILIO_COLONIA       VARCHAR(120),
  DOMICILIO_CP            VARCHAR(10),
  DOMICILIO_FISCAL        VARCHAR(200),

  -- Datos del vehículo
  MODALIDAD               VARCHAR(80),
  MARCA                   VARCHAR(60),
  ANIO_MODELO             VARCHAR(10),
  NIV_SERIE               VARCHAR(40),
  MOTOR                   VARCHAR(40),
  TIPO_VEHICULO           VARCHAR(40),
  CLASE                   VARCHAR(20),
  COMBUSTIBLE             VARCHAR(30),
  NUM_EJES                INT,
  NUM_LLANTAS             INT,

  -- Capacidad y dimensiones
  CAPACIDAD_LITROS        DECIMAL(10,2),
  CAPACIDAD_TONELADAS     DECIMAL(10,2),
  CAPACIDAD_PERSONAS      INT,
  ALTO_M                  DECIMAL(6,2),
  ANCHO_M                 DECIMAL(6,2),
  LARGO_M                 DECIMAL(6,2),
  PESO_VEHICULAR          DECIMAL(10,2),

  -- Suspensión y ejes
  TIPO_SUSPENSION         VARCHAR(40),
  EJE_DIRECCIONAL         VARCHAR(40),
  EJE_MOTRIZ              VARCHAR(40),
  EJE_ARRASTRE            VARCHAR(40),

  -- Datos del documento
  PERMISO_RUTA            VARCHAR(80),
  FOLIO                   VARCHAR(40),
  FOLIO_SERIE             VARCHAR(40),
  TRAMITE                 VARCHAR(80),
  LUGAR_EXPEDICION        VARCHAR(150),
  FECHA_EXPEDICION        DATE,
  -- En la tarjeta viene como "Fecha límite de sustitución de vehículo".
  FECHA_LIMITE_SUSTITUCION DATE,

  CREATION_DATE           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATE_DATE             TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_trailer_placas (PLACAS),
  KEY idx_trailer_status (STATUS),
  KEY idx_trailer_sustitucion (FECHA_LIMITE_SUSTITUCION)
);

-- 2) Documentos del tráiler --------------------------------------------
CREATE TABLE IF NOT EXISTS c_document_types_trailer (
  ID_DOCUMENT_TYPE    INT AUTO_INCREMENT PRIMARY KEY,
  DOCUMENT_TYPE_NAME  VARCHAR(100) NOT NULL,
  STATUS              TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_document_type_trailer_name (DOCUMENT_TYPE_NAME)
);

INSERT IGNORE INTO c_document_types_trailer (DOCUMENT_TYPE_NAME) VALUES
  ('Tarjeta de Circulación'),
  ('Verificación Físico-Mecánica'),
  ('Póliza de Seguro'),
  ('Permiso SICT'),
  ('Factura del Vehículo'),
  ('Placas'),
  ('Otro');

CREATE TABLE IF NOT EXISTS trailer_documents (
  ID_DOCUMENT       INT AUTO_INCREMENT PRIMARY KEY,
  ID_TRAILER        INT NOT NULL,
  ID_DOCUMENT_TYPE  INT NOT NULL,
  FILE_PATH         VARCHAR(255) NOT NULL,
  FILE_NAME         VARCHAR(255) NOT NULL,
  UPLOAD_DATE       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_TRAILER) REFERENCES trailers(ID_TRAILER),
  FOREIGN KEY (ID_DOCUMENT_TYPE) REFERENCES c_document_types_trailer(ID_DOCUMENT_TYPE)
);

-- 3) Dictamen de Verificación Físico-Mecánica --------------------------
-- Periódico: se guarda el histórico completo, no solo el último.
-- FECHA_VIGENCIA es hasta cuándo sirve el dictamen y es la que alimenta
-- el panel de vencimientos.
CREATE TABLE IF NOT EXISTS trailer_verificaciones (
  ID_VERIFICACION        INT AUTO_INCREMENT PRIMARY KEY,
  ID_TRAILER             INT NOT NULL,
  FOLIO_DICTAMEN         VARCHAR(40),
  NO_APROBACION          VARCHAR(60),
  NO_ACREDITACION        VARCHAR(60),
  RESULTADO              VARCHAR(30),
  TIPO_SERVICIO          VARCHAR(60),
  FECHA_VERIFICACION     DATE NOT NULL,
  HORA_INICIO            TIME,
  HORA_FINAL             TIME,
  FECHA_VERIFICACION_ANTERIOR DATE,
  FECHA_VIGENCIA         DATE,
  ODOMETRO               INT,
  SE_PRESENTO            VARCHAR(20),
  TECNICO_NOMBRE         VARCHAR(150),
  OBSERVACIONES          TEXT,
  ARCHIVO                VARCHAR(255),
  ARCHIVO_NOMBRE         VARCHAR(255),
  CREATION_DATE          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_verificacion_trailer (ID_TRAILER),
  KEY idx_verificacion_vigencia (FECHA_VIGENCIA),
  FOREIGN KEY (ID_TRAILER) REFERENCES trailers(ID_TRAILER)
);

-- 4) Submódulo dentro del grupo Flotilla que ya existe ------------------
-- El grupo 'grupo-cajas' es el que la barra lateral muestra como
-- "🚚 Flotilla" (hoy solo tiene Registro Cajas).
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'trailers', 'Registro Tráileres', 20
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

-- Permiso para todos los roles que ya ven Flotilla (incluye el rol 6,
-- Supervisor de Mantenimiento, que justamente solo ve este grupo).
INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'trailers';
