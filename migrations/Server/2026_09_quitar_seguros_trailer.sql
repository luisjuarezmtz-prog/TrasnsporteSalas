-- =====================================================================
-- Quitar del menú: Seguros de Tráiler
-- Sistema: Transportes Salas
-- Fecha: 2026-09
--
-- El módulo todavía no se va a activar, así que se saca del menú.
--
-- Por qué falla borrarlo directo desde phpMyAdmin (error #1451):
--   role_submodule_permissions tiene una llave foránea hacia
--   c_system_submodules, así que primero hay que borrar los permisos
--   que apuntan al submódulo y hasta entonces el submódulo.
--
-- Todo va por SUBMODULE_KEY y NO por ID: el id de este submódulo es 36
-- en producción y 38 en desarrollo, así que un script con el número
-- fijo borraría otra cosa en el ambiente equivocado.
--
-- NO se tocan las tablas de datos (trailer_seguros,
-- trailer_seguro_pagos, trailer_seguro_documentos) ni la pantalla
-- segurostrailer.html: esto solo quita la opción del menú. Si ya se
-- capturó alguna póliza, sigue ahí.
--
-- Al final del archivo está el SQL para reactivarlo cuando toque.
-- =====================================================================

-- 1) Primero los permisos (los hijos de la llave foránea) --------------
DELETE rsp
  FROM role_submodule_permissions rsp
  INNER JOIN c_system_submodules s ON s.ID_SUBMODULE = rsp.ID_SUBMODULE
 WHERE s.SUBMODULE_KEY = 'segurostrailer';

-- 2) Ahora sí el submódulo ---------------------------------------------
DELETE FROM c_system_submodules
 WHERE SUBMODULE_KEY = 'segurostrailer';

-- Comprobación: debe regresar 0 filas.
SELECT COUNT(*) AS debe_ser_cero
  FROM c_system_submodules
 WHERE SUBMODULE_KEY = 'segurostrailer';


-- =====================================================================
-- PARA REACTIVARLO DESPUÉS (no correr ahora)
-- =====================================================================
-- INSERT IGNORE INTO c_system_submodules (ID_MODULE, SUBMODULE_KEY, SUBMODULE_LABEL, ORDEN)
-- SELECT ID_MODULE, 'segurostrailer', 'Seguros de Tráiler', 40
--   FROM c_system_modules WHERE MODULE_KEY = 'grupo-cajas';
--
-- INSERT IGNORE INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
-- SELECT rmp.ID_ROLE, s.ID_SUBMODULE, 1
--   FROM c_system_submodules s
--   INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
--   INNER JOIN role_module_permissions rmp ON rmp.ID_MODULE = m.ID_MODULE AND rmp.CAN_VIEW = 1
--  WHERE s.SUBMODULE_KEY = 'segurostrailer';
--
-- =====================================================================
-- ALTERNATIVA SIN BORRAR NADA (más fácil de revertir)
-- =====================================================================
-- En vez de borrar, se puede dejar el submódulo registrado y solo
-- quitarle el permiso a todos los roles. Desaparece del menú igual, y
-- para reactivarlo basta con poner CAN_VIEW = 1:
--
-- UPDATE role_submodule_permissions rsp
--   INNER JOIN c_system_submodules s ON s.ID_SUBMODULE = rsp.ID_SUBMODULE
--    SET rsp.CAN_VIEW = 0
--  WHERE s.SUBMODULE_KEY = 'segurostrailer';
