-- =====================================================================
-- Migración: Módulo de Proveedores (alta / edición / baja)
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- Qué hace este script:
--   1. Crea `proveedores`: ficha principal del proveedor (estatus,
--      nombre empresarial, nombre comercial, RFC, días de crédito,
--      teléfono propio del proveedor, auditoría de alta).
--   2. Crea `proveedores_contacto_referencia`: UN contacto de
--      referencia por proveedor (relación 1:1, se aplica UNIQUE sobre
--      ID_PROVEEDOR). Tiene su propio teléfono, distinto del teléfono
--      del proveedor.
--   3. Crea `c_bancos`: catálogo de bancos (precargado con bancos
--      mexicanos comunes), usado por la cuenta bancaria del proveedor.
--   4. Crea `proveedores_cuenta`: igual que el patrón ya usado en
--      empleados (employee_bank_accounts) — cada proveedor puede tener
--      hasta 2 cuentas (PRINCIPAL y RESPALDO), cada una con banco,
--      número de cuenta y CLABE.
--   5. Crea `proveedores_direccion`: domicilio del proveedor (relación
--      1:1, UNIQUE sobre ID_PROVEEDOR).
--   6. Crea `c_document_types_proveedor`: catálogo de tipos de
--      documento específico de proveedores (distinto del catálogo de
--      documentos de empleados), con los 7 tipos solicitados.
--   7. Crea `documentos_proveedores`: n documentos por proveedor,
--      ligados al catálogo anterior (mismo patrón que
--      employee_documents).
--
-- NOTA: este módulo todavía NO se agrega al menú lateral ni al sistema
-- de permisos (c_system_modules / c_system_submodules) porque aún no
-- se ha confirmado en qué grupo del sidebar debe vivir. Esa parte se
-- agrega en una migración aparte una vez que se confirme la ubicación.
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con clave única en el nombre del banco/tipo de documento).
-- =====================================================================

-- 1) Ficha principal del proveedor ---------------------------------------
CREATE TABLE IF NOT EXISTS proveedores (
  ID_PROVEEDOR        INT AUTO_INCREMENT PRIMARY KEY,
  ESTATUS             TINYINT NOT NULL DEFAULT 1,
  NOMBRE_EMPRESARIAL  VARCHAR(150) NOT NULL,
  NOMBRE_PROVEEDOR    VARCHAR(150),
  RFC                 VARCHAR(13),
  DIAS_CREDITO        INT,
  TELEFONO            VARCHAR(15),
  USERNAME            VARCHAR(50),
  CREATION_DATE       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) Contacto de referencia (1 por proveedor) ----------------------------
CREATE TABLE IF NOT EXISTS proveedores_contacto_referencia (
  ID_CONTACTO_REFERENCIA  INT AUTO_INCREMENT PRIMARY KEY,
  ID_PROVEEDOR            INT NOT NULL UNIQUE,
  NOMBRE                  VARCHAR(150),
  TELEFONO                VARCHAR(15),
  EMAIL                   VARCHAR(100),
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR)
);

-- 3) Catálogo de bancos (precargado) -------------------------------------
CREATE TABLE IF NOT EXISTS c_bancos (
  ID_BANCO     INT AUTO_INCREMENT PRIMARY KEY,
  BANCO_NAME   VARCHAR(100) NOT NULL,
  STATUS       TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_banco_name (BANCO_NAME)
);

INSERT IGNORE INTO c_bancos (BANCO_NAME) VALUES
  ('BBVA México'),
  ('Santander México'),
  ('Banorte'),
  ('Citibanamex'),
  ('HSBC México'),
  ('Scotiabank México'),
  ('Banco Azteca'),
  ('Inbursa'),
  ('BanBajío'),
  ('Banregio'),
  ('Multiva'),
  ('Banco del Bienestar'),
  ('Bancoppel'),
  ('Actinver'),
  ('Ve por Más'),
  ('Compartamos Banco'),
  ('Invex'),
  ('Mifel'),
  ('Afirme'),
  ('Banjercito');

-- 4) Cuentas bancarias del proveedor (principal / respaldo) --------------
CREATE TABLE IF NOT EXISTS proveedores_cuenta (
  ID_CUENTA       INT AUTO_INCREMENT PRIMARY KEY,
  ID_PROVEEDOR    INT NOT NULL,
  TIPO_CUENTA     ENUM('PRINCIPAL','RESPALDO') NOT NULL,
  ID_BANCO        INT,
  NUMERO_CUENTA   VARCHAR(30),
  CLABE           VARCHAR(18),
  CREATION_DATE   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_proveedor_tipo_cuenta (ID_PROVEEDOR, TIPO_CUENTA),
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR),
  FOREIGN KEY (ID_BANCO) REFERENCES c_bancos(ID_BANCO)
);

-- 5) Domicilio del proveedor (1 por proveedor) ---------------------------
CREATE TABLE IF NOT EXISTS proveedores_direccion (
  ID_DIRECCION   INT AUTO_INCREMENT PRIMARY KEY,
  ID_PROVEEDOR   INT NOT NULL UNIQUE,
  CALLE          VARCHAR(150),
  NUM_EXT        VARCHAR(20),
  NUM_INT        VARCHAR(20),
  COLONIA        VARCHAR(100),
  COD_POSTAL     VARCHAR(10),
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR)
);

-- 6) Catálogo de tipos de documento de proveedor --------------------------
CREATE TABLE IF NOT EXISTS c_document_types_proveedor (
  ID_DOCUMENT_TYPE     INT AUTO_INCREMENT PRIMARY KEY,
  DOCUMENT_TYPE_NAME   VARCHAR(100) NOT NULL,
  STATUS               TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_document_type_proveedor_name (DOCUMENT_TYPE_NAME)
);

INSERT IGNORE INTO c_document_types_proveedor (DOCUMENT_TYPE_NAME) VALUES
  ('Contrato'),
  ('Acta Constitutiva'),
  ('Poder Notarial'),
  ('RFC'),
  ('Comprobante de Domicilio'),
  ('Cuenta Bancaria'),
  ('Identificación Representante Legal');

-- 7) Documentos subidos por proveedor (n por proveedor) ------------------
CREATE TABLE IF NOT EXISTS documentos_proveedores (
  ID_DOCUMENTO      INT AUTO_INCREMENT PRIMARY KEY,
  ID_PROVEEDOR      INT NOT NULL,
  ID_DOCUMENT_TYPE  INT NOT NULL,
  FILE_PATH         VARCHAR(255) NOT NULL,
  FILE_NAME         VARCHAR(255) NOT NULL,
  UPLOAD_DATE       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_PROVEEDOR) REFERENCES proveedores(ID_PROVEEDOR),
  FOREIGN KEY (ID_DOCUMENT_TYPE) REFERENCES c_document_types_proveedor(ID_DOCUMENT_TYPE)
);
