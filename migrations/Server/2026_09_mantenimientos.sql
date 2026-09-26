-- =====================================================================
-- Migración: Mantenimientos y Gestorías (con orden de compra)
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- DECISIONES DE DISEÑO (el cliente pidió la mejor opción):
--
-- 1. UN SOLO MÓDULO, NO DOS. Mantenimiento (trabajo físico sobre la
--    unidad) y gestoría (trámite administrativo) comparten casi todos
--    los campos: unidad, proveedor, fecha, monto, comprobante y
--    autorización. Se distinguen con la columna TIPO y un catálogo de
--    subtipos. Separarlos duplicaría todo sin ganar nada.
--
-- 2. LA ORDEN DE COMPRA NO ES UN MÓDULO APARTE: es el paso de
--    autorización del propio registro. Cuando se autoriza se genera el
--    FOLIO_OC (OC-00001) y se sella quién y cuándo. Así no hay dos
--    documentos que mantener sincronizados, y el flujo queda igual al
--    de nómina, que este sistema ya usa (generar -> autorizar).
--
--    Ciclo: SOLICITADA -> AUTORIZADA -> EN_PROCESO -> CONCLUIDA
--           (CANCELADA desde cualquier punto antes de concluir)
--
-- 3. DOS MONTOS, NO UNO. MONTO_ESTIMADO es con el que se autoriza la
--    orden; MONTO_REAL es lo que acabó costando. Sin esa separación no
--    se puede ver si el taller se pasó del presupuesto, que es la razón
--    de tener orden de compra.
--
-- 4. LA UNIDAD PUEDE SER TRÁILER O CAJA. El cliente pidió "placas caja
--    o trailer". El tráiler ya tiene catálogo (`trailers`) así que va
--    por llave foránea; la caja TODAVÍA NO tiene catálogo -- la
--    pantalla "Registro Cajas" es en realidad el formato de check, no
--    un registro de unidades -- así que para cajas las placas se
--    capturan como texto. Cuando exista el catálogo de cajas, se agrega
--    ID_CAJA sin tocar lo ya capturado.
--
-- 5. Una gestoría que renueva un documento (placas, verificación,
--    tarjeta) guarda FECHA_VENCIMIENTO_NUEVA, para que el trámite
--    alimente el panel de vencimientos en vez de vivir aislado.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Catálogo de subtipos ----------------------------------------------
CREATE TABLE IF NOT EXISTS c_tipos_mantenimiento (
  ID_TIPO      INT AUTO_INCREMENT PRIMARY KEY,
  TIPO         VARCHAR(15) NOT NULL,          -- MANTENIMIENTO | GESTORIA
  NOMBRE       VARCHAR(100) NOT NULL,
  STATUS       TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tipo_mantenimiento (TIPO, NOMBRE)
);

INSERT IGNORE INTO c_tipos_mantenimiento (TIPO, NOMBRE) VALUES
  ('MANTENIMIENTO', 'Preventivo'),
  ('MANTENIMIENTO', 'Correctivo'),
  ('MANTENIMIENTO', 'Afinación'),
  ('MANTENIMIENTO', 'Cambio de aceite'),
  ('MANTENIMIENTO', 'Llantas'),
  ('MANTENIMIENTO', 'Frenos'),
  ('MANTENIMIENTO', 'Suspensión'),
  ('MANTENIMIENTO', 'Sistema eléctrico'),
  ('MANTENIMIENTO', 'Motor'),
  ('MANTENIMIENTO', 'Transmisión'),
  ('MANTENIMIENTO', 'Hojalatería y pintura'),
  ('MANTENIMIENTO', 'Otro'),
  ('GESTORIA', 'Renovación de placas'),
  ('GESTORIA', 'Verificación físico-mecánica'),
  ('GESTORIA', 'Tarjeta de circulación'),
  ('GESTORIA', 'Permiso SICT'),
  ('GESTORIA', 'Trámite de seguro'),
  ('GESTORIA', 'Alta vehicular'),
  ('GESTORIA', 'Baja vehicular'),
  ('GESTORIA', 'Otro');

-- 2) Orden de mantenimiento / gestoría ----------------------------------
CREATE TABLE IF NOT EXISTS mantenimientos (
  ID_MANTENIMIENTO       INT AUTO_INCREMENT PRIMARY KEY,
  FOLIO_OC               VARCHAR(20) NULL,      -- se genera al autorizar
  TIPO                   VARCHAR(15) NOT NULL,  -- MANTENIMIENTO | GESTORIA
  ID_TIPO                INT NOT NULL,
  ESTATUS                VARCHAR(15) NOT NULL DEFAULT 'SOLICITADA',

  -- Unidad: tráiler (con catálogo) o caja (placas en texto por ahora)
  TIPO_UNIDAD            VARCHAR(10) NOT NULL DEFAULT 'TRAILER',
  ID_TRAILER             INT NULL,
  UNIDAD_PLACAS          VARCHAR(30),

  ID_PROVEEDOR           INT NOT NULL,
  DESCRIPCION            TEXT,

  FECHA_SOLICITUD        DATE NOT NULL,
  FECHA_PROGRAMADA       DATE,
  FECHA_CONCLUSION       DATE,

  ODOMETRO               INT,
  MONTO_ESTIMADO         DECIMAL(12,2) NOT NULL DEFAULT 0,
  MONTO_REAL             DECIMAL(12,2),

  -- Solo para gestorías que renuevan un documento
  FECHA_VENCIMIENTO_NUEVA DATE,

  AUTORIZADO_POR         VARCHAR(30),
  FECHA_AUTORIZACION     DATETIME,

  OBSERVACIONES          TEXT,
  USUARIO                VARCHAR(30),
  CREATION_DATE          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATE_DATE            TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_folio_oc (FOLIO_OC),
  KEY idx_mant_estatus (ESTATUS),
  KEY idx_mant_trailer (ID_TRAILER),
  KEY idx_mant_vencimiento (FECHA_VENCIMIENTO_NUEVA),
  FOREIGN KEY (ID_TIPO) REFERENCES c_tipos_mantenimiento(ID_TIPO),
  FOREIGN KEY (ID_TRAILER) REFERENCES trailers(ID_TRAILER),
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR)
);

-- 3) Comprobantes (factura del taller, documento del trámite) -----------
CREATE TABLE IF NOT EXISTS mantenimiento_documentos (
  ID_DOCUMENTO      INT AUTO_INCREMENT PRIMARY KEY,
  ID_MANTENIMIENTO  INT NOT NULL,
  FILE_PATH         VARCHAR(255) NOT NULL,
  FILE_NAME         VARCHAR(255) NOT NULL,
  UPLOAD_DATE       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mant_doc (ID_MANTENIMIENTO),
  FOREIGN KEY (ID_MANTENIMIENTO) REFERENCES mantenimientos(ID_MANTENIMIENTO) ON DELETE CASCADE
);

-- 4) Submódulo dentro del grupo Flotilla ---------------------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'mantenimientos', 'Mantenimientos y Gestorías', 50
  FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
  FROM c_system_submodules s
  INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
  INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
 WHERE s.SUBMODULE_KEY = 'mantenimientos';
