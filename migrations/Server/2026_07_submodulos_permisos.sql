-- =====================================================================
-- Migración: Permisos por submódulo (segundo nivel dentro de cada
--            grupo del menú, p.ej. dentro de "Gestión de Viajes")
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- Qué hace este script:
--   1. Crea `c_system_submodules`: catálogo de las opciones que hay
--      dentro de cada grupo del menú (cada botón de cada
--      dropdown-container en dashboard.html), ligado a
--      `c_system_modules` por ID_MODULE.
--   2. Siembra el catálogo con las opciones actuales de cada grupo.
--   3. Crea `role_submodule_permissions`: igual que
--      `role_module_permissions` pero a nivel submódulo, para poder
--      limitar, por ejemplo, que un rol solo vea "Consulta Viajes"
--      dentro de "Gestión de Viajes" y no el resto de las opciones.
--   4. Da acceso a todo por default a todos los roles existentes
--      (mismo criterio que ya se usa con los módulos: nadie pierde
--      acceso a nada por correr esta migración).
--
-- Es seguro volver a correrlo (CREATE TABLE IF NOT EXISTS + INSERT
-- IGNORE con claves únicas).
-- =====================================================================

-- 1) Catálogo de submódulos --------------------------------------------
CREATE TABLE IF NOT EXISTS c_system_submodules (
  ID_SUBMODULE     INT AUTO_INCREMENT PRIMARY KEY,
  ID_MODULE        INT NOT NULL,
  SUBMODULE_KEY    VARCHAR(50) NOT NULL UNIQUE,
  SUBMODULE_LABEL  VARCHAR(100) NOT NULL,
  ORDEN            INT NOT NULL DEFAULT 0,
  FOREIGN KEY (ID_MODULE) REFERENCES c_system_modules(ID_MODULE)
);

-- 2) Semilla: una fila por cada botón dentro de cada grupo del menú ----
INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
SELECT ID_MODULE, 'registroviajes', 'Registro Viajes', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-viajes'
UNION ALL SELECT ID_MODULE, 'consultarviajes', 'Consulta Viajes', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-viajes'
UNION ALL SELECT ID_MODULE, 'agendaviajes', 'Agenda Viajes', 30 FROM c_system_modules WHERE MODULE_KEY = 'grupo-viajes'
UNION ALL SELECT ID_MODULE, 'regmovviajes', 'Reg. Movimientos', 40 FROM c_system_modules WHERE MODULE_KEY = 'grupo-viajes'
UNION ALL SELECT ID_MODULE, 'consulviajesmov', 'Consulta Movi', 50 FROM c_system_modules WHERE MODULE_KEY = 'grupo-viajes'

UNION ALL SELECT ID_MODULE, 'regtarimas', 'Registro Tarimas', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-tarimas'
UNION ALL SELECT ID_MODULE, 'editartarimas', 'Editar Tarimas', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-tarimas'
UNION ALL SELECT ID_MODULE, 'consultatarimas', 'Consulta Tarimas', 30 FROM c_system_modules WHERE MODULE_KEY = 'grupo-tarimas'

UNION ALL SELECT ID_MODULE, 'empleados', 'Alta / Baja / Cambio', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-empleados'

UNION ALL SELECT ID_MODULE, 'calculonomina', 'Generar Nómina', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'consultarnominas', 'Consultar Nóminas', 20 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'revisarnomina', 'Revisar Nómina', 30 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'autorizarnomina', 'Autorización Nómina', 40 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'regprestamos', 'Reg. Préstamos', 50 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'consultarprestamos', 'Consultar Préstamos', 60 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'
UNION ALL SELECT ID_MODULE, 'cajaahorro', 'Caja Ahorro', 70 FROM c_system_modules WHERE MODULE_KEY = 'grupo-nomina'

UNION ALL SELECT ID_MODULE, 'checkcajas', 'Registro Cajas', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas'

UNION ALL SELECT ID_MODULE, 'usuarios', 'Usuarios y Roles', 10 FROM c_system_modules WHERE MODULE_KEY = 'grupo-admin';

-- 3) Matriz de permisos por submódulo -----------------------------------
CREATE TABLE IF NOT EXISTS role_submodule_permissions (
  ID_ROLE       INT NOT NULL,
  ID_SUBMODULE  INT NOT NULL,
  CAN_VIEW      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (ID_ROLE, ID_SUBMODULE),
  FOREIGN KEY (ID_ROLE) REFERENCES c_roles(ID_ROLE),
  FOREIGN KEY (ID_SUBMODULE) REFERENCES c_system_submodules(ID_SUBMODULE)
);

-- 4) Todos los roles existentes conservan acceso a todo por default -----
INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
SELECT r.ID_ROLE, s.ID_SUBMODULE, 1
FROM c_roles r
CROSS JOIN c_system_submodules s;
