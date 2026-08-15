-- =====================================================================
-- Migración: Ubicar el módulo de Proveedores dentro de Cuentas por Cobrar
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- Qué hace este script:
--   Ya se confirmó la ubicación del módulo de Proveedores en el sidebar:
--   vive dentro del grupo "Cuentas por Cobrar" (grupo-cxc), como un
--   tercer submódulo junto a "Movimiento de Viajes" y "Factura CXC".
--
--   1. Agrega el submódulo 'proveedores' a c_system_submodules, colgado
--      del mismo ID_MODULE que 'grupo-cxc'.
--   2. Da acceso por default a todos los roles existentes (mismo
--      criterio usado en las demás migraciones de permisos: nadie pierde
--      acceso a nada nuevo).
--
-- Es seguro volver a correrlo (INSERT IGNORE + UNIQUE KEY en
-- SUBMODULE_KEY, heredada de la migración de submódulos).
-- =====================================================================

INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'proveedores', 'Proveedores', 30
FROM c_system_modules
WHERE MODULE_KEY = 'grupo-cxc';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s
WHERE s.SUBMODULE_KEY = 'proveedores';
