-- =====================================================================
-- Migración: Módulo de Empleados — cuentas bancarias, foto y documentos
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- Qué hace este script:
--   1. Agrega PHOTO_PATH a `employees` (ruta de la foto de perfil).
--   2. Crea `employee_bank_accounts`: cada empleado puede tener hasta
--      2 cuentas (PRINCIPAL y PROVISIONAL), cada una con número de
--      cuenta, número de tarjeta y CLABE interbancaria.
--   3. Crea `c_document_types`: catálogo de tipos de documento
--      (IFE, Acta de nacimiento, Fotografía, CURP, RFC, Comprobante de
--      domicilio, Estado de cuenta, Formato de relación laboral,
--      Solicitud de empleo).
--   4. Crea `employee_documents`: n documentos por empleado, cada uno
--      ligado a un tipo del catálogo anterior.
--   5. Corrige `employees.IMSS`: estaba definida como numérica y muy
--      chica, así que un número de IMSS real (11 dígitos) se
--      desbordaba ("Out of range value for column 'IMSS'") al dar de
--      alta un empleado. Se cambia a VARCHAR (es un identificador, no
--      una cantidad, igual que RFC/CURP).
--
-- Es seguro volver a correrlo (usa un chequeo de information_schema
-- para PHOTO_PATH, e IF NOT EXISTS / INSERT IGNORE con UNIQUE KEY para
-- lo demás; el ALTER de IMSS es idempotente, MODIFY no falla si ya
-- quedó como VARCHAR).
-- =====================================================================

-- 1) Foto de perfil del empleado --------------------------------------
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'PHOTO_PATH'
);
SET @sql_photo = IF(@col_exists = 0,
  'ALTER TABLE employees ADD COLUMN PHOTO_PATH VARCHAR(255) NULL',
  'SELECT ''employees.PHOTO_PATH ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_photo FROM @sql_photo;
EXECUTE stmt_photo;
DEALLOCATE PREPARE stmt_photo;

-- 2) Cuentas bancarias (principal / provisional) -----------------------
CREATE TABLE IF NOT EXISTS employee_bank_accounts (
  ID_BANK_ACCOUNT   INT AUTO_INCREMENT PRIMARY KEY,
  ID_EMPLOYEE       INT NOT NULL,
  TIPO_CUENTA       ENUM('PRINCIPAL','PROVISIONAL') NOT NULL,
  ACCOUNT_NUMBER    VARCHAR(30),
  CARD_NUMBER       VARCHAR(30),
  CLABE             VARCHAR(18),
  CREATION_DATE     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empleado_tipo_cuenta (ID_EMPLOYEE, TIPO_CUENTA),
  FOREIGN KEY (ID_EMPLOYEE) REFERENCES employees(ID_EMPLOYEE)
);

-- 3) Catálogo de tipos de documento -------------------------------------
CREATE TABLE IF NOT EXISTS c_document_types (
  ID_DOCUMENT_TYPE    INT AUTO_INCREMENT PRIMARY KEY,
  DOCUMENT_TYPE_NAME  VARCHAR(100) NOT NULL,
  STATUS              TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_document_type_name (DOCUMENT_TYPE_NAME)
);

INSERT IGNORE INTO c_document_types (DOCUMENT_TYPE_NAME) VALUES
  ('IFE'),
  ('Acta de nacimiento'),
  ('Fotografía'),
  ('CURP'),
  ('RFC'),
  ('Comprobante de domicilio'),
  ('Estado de cuenta'),
  ('Formato de relación laboral'),
  ('Solicitud de empleo');

-- 4) Documentos subidos por empleado (n por empleado) -------------------
CREATE TABLE IF NOT EXISTS employee_documents (
  ID_DOCUMENT       INT AUTO_INCREMENT PRIMARY KEY,
  ID_EMPLOYEE       INT NOT NULL,
  ID_DOCUMENT_TYPE  INT NOT NULL,
  FILE_PATH         VARCHAR(255) NOT NULL,
  FILE_NAME         VARCHAR(255) NOT NULL,
  UPLOAD_DATE       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_EMPLOYEE) REFERENCES employees(ID_EMPLOYEE),
  FOREIGN KEY (ID_DOCUMENT_TYPE) REFERENCES c_document_types(ID_DOCUMENT_TYPE)
);

-- 5) Corrección de employees.IMSS (era numérica, se desbordaba) --------
ALTER TABLE employees MODIFY IMSS VARCHAR(15) NULL;
