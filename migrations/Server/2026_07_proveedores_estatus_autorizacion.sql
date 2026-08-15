-- =====================================================================
-- Migración: Estatus de autorización para Proveedores
-- Sistema: Transportes Salas
-- Fecha: 2026-07
--
-- Qué hace este script:
--   Cambia el significado de `proveedores.ESTATUS`. Antes era un simple
--   Activo(1)/Baja(0). Ahora, al terminar de registrar un proveedor
--   queda "En Autorización" y alguien debe decidir si se autoriza o se
--   rechaza (mismo patrón de botones directos en la tabla que ya se usa
--   en Facturas CXC):
--     1 = En Autorización (estado inicial al dar de alta)
--     2 = Autorizado
--     3 = Rechazado
--
--   Si ya se había corrido la migración anterior (2026_07_proveedores.sql)
--   y se llegó a registrar algún proveedor con la semántica vieja, este
--   script reacomoda esos datos: los que estaban "Activo" (1) pasan a
--   "Autorizado" (2), y los que estaban en "Baja" (0) pasan a
--   "Rechazado" (3). Los proveedores nuevos, a partir de ahora, nacen en
--   ESTATUS = 1 ("En Autorización"), tal como ya lo hace
--   routes/proveedores.js.
--
-- Es seguro volver a correrlo: los UPDATE son idempotentes (no hay nada
-- que migrar dos veces una vez que ya no quedan filas en 0).
-- =====================================================================

UPDATE proveedores SET ESTATUS = 2 WHERE ESTATUS = 1;
UPDATE proveedores SET ESTATUS = 3 WHERE ESTATUS = 0;
