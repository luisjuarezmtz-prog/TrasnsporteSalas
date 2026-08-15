-- =====================================================================
-- Migración: Permisos de módulos por rol + soporte de passwords con hash
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- IMPORTANTE: `c_roles` ya existe en tu base (con FK desde
-- dw_employees.ID_ROLE) y ya tiene tus 6 roles reales dados de alta
-- (DIRECTOR GENERAL, GERENTE OPERACIONES, GERENTE ADMINISTRATIVO,
-- OPERADOR, GERENTE SISTEMAS, SUPERVISOR DE MANTENIMIENTO). Este script
-- NO la crea ni la vuelve a sembrar; solo le agrega la columna STATUS
-- (para poder activar/desactivar un rol desde el nuevo módulo, igual
-- que ya se hace con empleados/usuarios) y usa sus datos tal cual están.
--
-- Qué hace este script:
--   1. Agrega STATUS a c_roles (columna nueva, no toca lo que ya tiene).
--   2. Crea la tabla c_system_modules (catálogo de los grupos del menú
--      del dashboard: Viajes, Tarimas, Empleados, Nómina, Flotilla y el
--      nuevo grupo de Administración).
--   3. Crea la tabla role_module_permissions (qué rol ve qué módulo).
--   4. Siembra los permisos para los roles que ya existen en c_roles,
--      preservando el comportamiento actual: el rol 6 (SUPERVISOR DE
--      MANTENIMIENTO) sigue restringido (sin Viajes/Tarimas/Empleados/
--      Nómina/Administración, solo ve Flotilla) y todos los demás
--      roles conservan acceso total, tal como funcionaba antes con el
--      `if (rol === '6')` en el dashboard.
--   5. Amplía la columna PASSWORD de `users` a VARCHAR(255) para que
--      quepa un hash de bcrypt (los valores en texto plano que ya
--      tiene siguen funcionando igual, no se tocan).
--
-- Cómo correrlo: ejecútalo completo una sola vez contra tu base de
-- datos. Es seguro volver a correrlo (los pasos 2-4 usan IF NOT EXISTS
-- / INSERT IGNORE; el paso 1 usa un chequeo de information_schema para
-- no fallar si ya corriste el script antes).
-- =====================================================================

-- 1) Columna STATUS en c_roles (solo si todavía no existe) ------------
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'c_roles' AND COLUMN_NAME = 'STATUS'
);
SET @sql_status = IF(@col_exists = 0,
  'ALTER TABLE c_roles ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1',
  'SELECT ''c_roles.STATUS ya existía, no se modificó nada.'' AS aviso');
PREPARE stmt_status FROM @sql_status;
EXECUTE stmt_status;
DEALLOCATE PREPARE stmt_status;

-- 2) Catálogo de módulos del dashboard --------------------------------
CREATE TABLE IF NOT EXISTS c_system_modules (
  ID_MODULE     INT AUTO_INCREMENT PRIMARY KEY,
  MODULE_KEY    VARCHAR(50) NOT NULL UNIQUE,   -- coincide con el id del <div> del menú
  MODULE_LABEL  VARCHAR(100) NOT NULL,
  ORDEN         INT NOT NULL DEFAULT 0
);

INSERT IGNORE INTO c_system_modules (MODULE_KEY, MODULE_LABEL, ORDEN) VALUES
  ('grupo-viajes',    'Gestión de Viajes',       10),
  ('grupo-tarimas',   'Control de Tarimas',      20),
  ('grupo-empleados', 'Empleados',               30),
  ('grupo-nomina',    'Nómina y Préstamos',      40),
  ('grupo-cajas',     'Flotilla',                50),
  ('grupo-admin',     'Administración (Usuarios y Roles)', 60);

-- 3) Permisos por rol/módulo -------------------------------------------
CREATE TABLE IF NOT EXISTS role_module_permissions (
  ID_ROLE     INT NOT NULL,
  ID_MODULE   INT NOT NULL,
  CAN_VIEW    TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (ID_ROLE, ID_MODULE),
  FOREIGN KEY (ID_ROLE) REFERENCES c_roles(ID_ROLE),
  FOREIGN KEY (ID_MODULE) REFERENCES c_system_modules(ID_MODULE)
);

-- Sembrar: por defecto TODOS los roles que ya existen en c_roles ven
-- TODOS los módulos (así se comportaba el sistema antes de esta
-- migración para cualquier rol distinto de 6).
INSERT IGNORE INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
SELECT r.ID_ROLE, m.ID_MODULE, 1
FROM c_roles r
CROSS JOIN c_system_modules m;

-- Excepción: el rol 6 (SUPERVISOR DE MANTENIMIENTO) se queda igual que
-- antes -> solo ve Flotilla.
UPDATE role_module_permissions
SET CAN_VIEW = 0
WHERE ID_ROLE = 6 AND ID_MODULE IN (
  SELECT ID_MODULE FROM c_system_modules WHERE MODULE_KEY <> 'grupo-cajas'
);

-- 4) Soporte de passwords con hash (bcrypt) ----------------------------
-- Los hashes de bcrypt miden ~60 caracteres; tu columna PASSWORD hoy es
-- VARCHAR(50), por lo que esto es necesario (no solo preventivo) para
-- que quepa un hash completo. Los valores que ya tiene en texto plano
-- no se ven afectados.
ALTER TABLE users MODIFY PASSWORD VARCHAR(255) NOT NULL;

-- =====================================================================
-- Fin de la migración. A partir de aquí:
--   - El módulo "Usuarios y Roles" del dashboard permite crear roles,
--     editar la matriz de permisos por módulo, y dar de alta/baja/
--     cambio a los usuarios (ligándolos a un empleado y un rol; esto
--     internamente resuelve/crea el registro correspondiente en
--     dw_employees, que es donde vive ID_ROLE).
--   - Los usuarios NUEVOS que se den de alta desde ese módulo guardan
--     su password ya encriptado con bcrypt.
--   - Los usuarios que ya existían siguen entrando igual que siempre
--     (texto plano) hasta que alguien les resetee la contraseña desde
--     el nuevo módulo, momento en el que quedará encriptada también.
-- =====================================================================
