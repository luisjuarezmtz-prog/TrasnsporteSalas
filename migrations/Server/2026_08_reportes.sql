-- =====================================================================
-- Migración: Módulo "Reportes" (Préstamos y Caja de Ahorro)
-- Sistema: Transportes Salas
-- Fecha: 2026-08
--
-- Registra el nuevo grupo de menú "Reportes" con 2 submódulos
-- (Préstamos, Caja de Ahorro), mismo patrón que las migraciones
-- anteriores de módulos/submódulos. No crea tablas nuevas — los
-- reportes solo consultan datos que ya existen (reg_prestamos,
-- abono_prestamos, caja_ahorro, reg_prestamos_externos,
-- abono_prestamos_externos, caja_ahorro_externo).
--
-- Es seguro volver a correrlo (INSERT IGNORE con claves únicas).
-- =====================================================================

INSERT IGNORE INTO c_system_modules (MODULE_KEY, MODULE_LABEL, ORDEN) VALUES
  ('grupo-reportes', 'Reportes', 55);

INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'reportesprestamos', 'Préstamos', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-reportes'
UNION ALL SELECT ID_MODULE, 'reportescajaahorro', 'Caja de Ahorro', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-reportes';

INSERT IGNORE INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
SELECT r.ID_ROLE, m.ID_MODULE, 1
FROM c_roles r
CROSS JOIN c_system_modules m
WHERE m.MODULE_KEY = 'grupo-reportes';

INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s
WHERE s.SUBMODULE_KEY IN ('reportesprestamos', 'reportescajaahorro');

-- Mantiene consistente la restricción ya existente del rol 6 (Supervisor
-- de Mantenimiento), que hoy solo ve Flotilla.
UPDATE role_module_permissions
SET CAN_VIEW = 0
WHERE ID_ROLE = 6 AND ID_MODULE IN (
  SELECT ID_MODULE FROM c_system_modules WHERE MODULE_KEY = 'grupo-reportes'
);
