-- =====================================================================
-- Migración: El Resumen General (Inicio) como módulo con permisos
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- Hasta ahora el botón "Inicio" del menú era el único que no pasaba por
-- el control de permisos: se mostraba siempre, sin importar el rol. Eso
-- significa que cualquier usuario veía el Resumen General con ingresos,
-- gastos y utilidad de toda la empresa, y no había forma de quitárselo
-- desde Usuarios y Roles.
--
-- Se registra como un módulo más (`grupo-inicio`) para que aparezca en
-- la pantalla de Roles y Permisos de Módulos junto a los demás.
--
-- Se concede a TODOS los roles a propósito: hoy todos lo ven, así que
-- otorgarlo por default no le cambia el acceso a nadie. La diferencia
-- es que a partir de ahora se puede revocar por rol desde la UI -- útil
-- sobre todo para perfiles operativos que no tienen por qué ver la
-- utilidad de la empresa.
--
-- Va con ORDEN = 5 para quedar arriba de Gestión de Viajes (10), igual
-- que en el menú.
--
-- Es seguro volver a correrlo (INSERT IGNORE sobre claves únicas).
-- =====================================================================

INSERT IGNORE INTO c_system_modules (MODULE_KEY, MODULE_LABEL, ORDEN) VALUES
  ('grupo-inicio', 'Inicio (Resumen General)', 5);

INSERT IGNORE INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
SELECT r.ID_ROLE, m.ID_MODULE, 1
  FROM c_roles r
  CROSS JOIN c_system_modules m
 WHERE m.MODULE_KEY = 'grupo-inicio';
