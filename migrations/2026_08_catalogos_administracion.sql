-- =====================================================================
-- Migración: Submódulo "Catálogos del Sistema" (Administración)
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- Qué hace este script:
--   1. Agrega columna STATUS (TINYINT, default 1 = activo) a los
--      catálogos que todavía no la tenían, para poder dar de baja un
--      valor sin borrar la fila (mismo criterio ya usado en c_bancos y
--      c_document_types): c_cedis, c_type_motions, c_employee_types,
--      c_contract_types, c_educations, c_genders.
--   2. Agrega el submódulo 'catalogos' dentro del grupo "Administración"
--      (grupo-admin), junto a "Usuarios y Roles".
--   3. Da acceso por default a todos los roles existentes.
--
-- NOTA: tu versión de MySQL no soporta "ADD COLUMN IF NOT EXISTS" (eso
-- solo existe en MySQL 8.0.29+ / MariaDB 10.x), por eso aquí se usa
-- ADD COLUMN normal. Si ya corriste este script una vez y lo vuelves a
-- correr, cada ALTER va a marcar error "Duplicate column name 'STATUS'"
-- en las tablas que ya la tengan — es seguro ignorar ese error puntual
-- y seguir con el resto del script (o comentar la línea ya aplicada).
-- =====================================================================

ALTER TABLE c_cedis          ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;
ALTER TABLE c_type_motions   ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;
ALTER TABLE c_employee_types ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;
ALTER TABLE c_contract_types ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;
ALTER TABLE c_educations     ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;
ALTER TABLE c_genders        ADD COLUMN STATUS TINYINT NOT NULL DEFAULT 1;

-- Submódulo dentro de Administración -------------------------------------
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'catalogos', 'Catálogos del Sistema', 20
FROM c_system_modules
WHERE MODULE_KEY = 'grupo-admin';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s
WHERE s.SUBMODULE_KEY = 'catalogos';
