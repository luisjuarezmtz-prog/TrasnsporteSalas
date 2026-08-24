-- =====================================================================
-- Migración: Módulo "Personal Externo"
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- Qué hace este script:
--   1. Crea `personal_externo` (ficha de datos personales/domicilio/
--      contacto), mirror de `employees` pero SIN las columnas de datos
--      laborales (tipo de empleado, contrato, escolaridad, salario,
--      IMSS, operador) que no aplican a personal externo. Reutiliza el
--      catálogo `c_genders` que ya existe (es genérico, no exclusivo de
--      empleados).
--   2. Crea `personal_externo_bank_accounts` (cuentas Principal/
--      Provisional), mirror exacto de `employee_bank_accounts`.
--   3. Crea el catálogo propio `c_document_types_externo` y la tabla
--      `personal_externo_documents`, mismo patrón que ya existe por
--      separado para Empleados (`c_document_types`/`employee_documents`)
--      y Proveedores (`c_document_types_proveedor`/`documentos_proveedores`).
--   4. Crea `reg_prestamos_externos` + `abono_prestamos_externos` con
--      los mismos 2 triggers que ya existen para `reg_prestamos`/
--      `abono_prestamos` (siembra de abono en cero al otorgar el
--      préstamo, y auto-cierre cuando el saldo llega a 0).
--   5. Crea `caja_ahorro_externo`, mirror de `caja_ahorro` (agregando la
--      FK real a `personal_externo` que el original no tiene).
--   6. Registra el nuevo grupo de menú "Personal Externo" y sus 4
--      submódulos en `c_system_modules`/`c_system_submodules`, dando
--      acceso por default a todos los roles existentes (mismo criterio
--      que las migraciones anteriores), y respetando la restricción ya
--      existente del rol 6 (Supervisor de Mantenimiento, que solo ve
--      Flotilla).
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Ficha principal de Personal Externo -------------------------------
CREATE TABLE IF NOT EXISTS personal_externo (
  ID_EXTERNO         INT AUTO_INCREMENT PRIMARY KEY,
  STATUS              TINYINT(1) NOT NULL DEFAULT 1,
  FIRST_NAME          VARCHAR(50) NOT NULL,
  MIDDLE_NAME         VARCHAR(50),
  PARENTAL_LAST       VARCHAR(50) NOT NULL,
  MOTHER_LAST         VARCHAR(50),
  ID_GENDER           INT,
  BIRTHDAY            DATE,
  BIRTHPLACE          VARCHAR(50),
  MAIL                VARCHAR(50),
  RFC                 VARCHAR(13),
  CURP                VARCHAR(18),
  STATE               VARCHAR(50),
  CITY                VARCHAR(30),
  COLONIA             VARCHAR(50),
  STREET              VARCHAR(50),
  EXTERIOR_NUMBER     VARCHAR(20),
  INTERIOR_NUMBER     VARCHAR(20),
  POST_CODE           INT,
  CELL_PHONE          VARCHAR(15),
  HOME_PHONE          VARCHAR(15),
  EMERGENCY_CONTACT   VARCHAR(50),
  EMERGENCY_NUMBER    VARCHAR(12),
  CREATION_DATE       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_GENDER) REFERENCES c_genders(ID_GENDER)
);

-- 2) Cuentas bancarias (Principal / Provisional) ------------------------
CREATE TABLE IF NOT EXISTS personal_externo_bank_accounts (
  ID_BANK_ACCOUNT  INT AUTO_INCREMENT PRIMARY KEY,
  ID_EXTERNO       INT NOT NULL,
  TIPO_CUENTA      ENUM('PRINCIPAL','PROVISIONAL') NOT NULL,
  ACCOUNT_NUMBER   VARCHAR(30),
  CARD_NUMBER      VARCHAR(30),
  CLABE            VARCHAR(18),
  CREATION_DATE    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_externo_tipo_cuenta (ID_EXTERNO, TIPO_CUENTA),
  FOREIGN KEY (ID_EXTERNO) REFERENCES personal_externo(ID_EXTERNO)
);

-- 3) Documentos (catálogo propio + tabla de archivos) -------------------
CREATE TABLE IF NOT EXISTS c_document_types_externo (
  ID_DOCUMENT_TYPE    INT AUTO_INCREMENT PRIMARY KEY,
  DOCUMENT_TYPE_NAME  VARCHAR(100) NOT NULL,
  STATUS              TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_document_type_externo_name (DOCUMENT_TYPE_NAME)
);

INSERT IGNORE INTO c_document_types_externo (DOCUMENT_TYPE_NAME) VALUES
  ('IFE'), ('Acta de Nacimiento'), ('Fotografía'), ('CURP'), ('RFC'),
  ('Comprobante de Domicilio'), ('Estado de Cuenta');

CREATE TABLE IF NOT EXISTS personal_externo_documents (
  ID_DOCUMENT       INT AUTO_INCREMENT PRIMARY KEY,
  ID_EXTERNO        INT NOT NULL,
  ID_DOCUMENT_TYPE  INT NOT NULL,
  FILE_PATH         VARCHAR(255) NOT NULL,
  FILE_NAME         VARCHAR(255) NOT NULL,
  UPLOAD_DATE       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ID_EXTERNO) REFERENCES personal_externo(ID_EXTERNO),
  FOREIGN KEY (ID_DOCUMENT_TYPE) REFERENCES c_document_types_externo(ID_DOCUMENT_TYPE)
);

-- 4) Préstamos ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reg_prestamos_externos (
  ID_PRESTAMO     INT AUTO_INCREMENT PRIMARY KEY,
  FOLIO           VARCHAR(50),
  ID_EXTERNO      INT,
  MONTO_PRESTAMO  INT,
  ESTATUS         INT DEFAULT 1,
  USUARIO         VARCHAR(30),
  FECHA_CREACION  TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (ID_EXTERNO) REFERENCES personal_externo(ID_EXTERNO)
);

CREATE TABLE IF NOT EXISTS abono_prestamos_externos (
  ID_ABONO        INT AUTO_INCREMENT PRIMARY KEY,
  ID_PRESTAMO     INT,
  MONTO_ABONO     INT,
  MONTO_RESTANTE  INT,
  USUARIO         VARCHAR(30),
  FECHA_CREACION  TIMESTAMP NULL DEFAULT NULL,
  FOLIO           VARCHAR(50),
  UNIQUE KEY idx_prestamo_folio_externo (ID_PRESTAMO, FOLIO),
  FOREIGN KEY (ID_PRESTAMO) REFERENCES reg_prestamos_externos(ID_PRESTAMO)
);

-- Mismo par de triggers que reg_prestamos/abono_prestamos, apuntando a
-- las tablas de personal externo.
DROP TRIGGER IF EXISTS after_reg_prestamos_externos_insert;
DELIMITER $$
CREATE TRIGGER after_reg_prestamos_externos_insert
AFTER INSERT ON reg_prestamos_externos
FOR EACH ROW
BEGIN
  INSERT INTO abono_prestamos_externos (ID_PRESTAMO, MONTO_ABONO, MONTO_RESTANTE, USUARIO, FECHA_CREACION, FOLIO)
  VALUES (NEW.ID_PRESTAMO, 0, NEW.MONTO_PRESTAMO, NEW.USUARIO, NEW.FECHA_CREACION, NEW.FOLIO);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS actualiza_estatus_prestamo_externo_insert;
DELIMITER $$
CREATE TRIGGER actualiza_estatus_prestamo_externo_insert
AFTER INSERT ON abono_prestamos_externos
FOR EACH ROW
BEGIN
  IF NEW.MONTO_RESTANTE = 0 THEN
    UPDATE reg_prestamos_externos SET ESTATUS = 0 WHERE ID_PRESTAMO = NEW.ID_PRESTAMO;
  END IF;
END$$
DELIMITER ;

-- 5) Caja de ahorro ---------------------------------------------------
CREATE TABLE IF NOT EXISTS caja_ahorro_externo (
  id_caja_ahorro_externo  INT AUTO_INCREMENT PRIMARY KEY,
  ID_EXTERNO              INT,
  monto                   INT,
  ano                     INT,
  UNIQUE KEY caja_ahorro_externo_pk (ID_EXTERNO, ano),
  FOREIGN KEY (ID_EXTERNO) REFERENCES personal_externo(ID_EXTERNO)
);

-- 6) Registro de módulo / submódulos / permisos --------------------------
INSERT IGNORE INTO c_system_modules (MODULE_KEY, MODULE_LABEL, ORDEN) VALUES
  ('grupo-personal-externo', 'Personal Externo', 35);

INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'personalexterno', 'Alta / Baja / Cambio', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-personal-externo'
UNION ALL SELECT ID_MODULE, 'regprestamosexterno', 'Reg. Préstamos', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-personal-externo'
UNION ALL SELECT ID_MODULE, 'consultarprestamosexterno', 'Consultar Préstamos', 30 FROM c_system_modules WHERE MODULE_KEY = 'grupo-personal-externo'
UNION ALL SELECT ID_MODULE, 'cajaahorroexterno', 'Caja Ahorro', 40 FROM c_system_modules WHERE MODULE_KEY = 'grupo-personal-externo';

INSERT IGNORE INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
SELECT r.ID_ROLE, m.ID_MODULE, 1
FROM c_roles r
CROSS JOIN c_system_modules m
WHERE m.MODULE_KEY = 'grupo-personal-externo';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s
WHERE s.SUBMODULE_KEY IN ('personalexterno', 'regprestamosexterno', 'consultarprestamosexterno', 'cajaahorroexterno');

-- Mantiene consistente la restricción ya existente del rol 6 (Supervisor
-- de Mantenimiento), que hoy solo ve Flotilla.
UPDATE role_module_permissions
SET CAN_VIEW = 0
WHERE ID_ROLE = 6 AND ID_MODULE IN (
  SELECT ID_MODULE FROM c_system_modules WHERE MODULE_KEY = 'grupo-personal-externo'
);
