// routes/roles.js — Catálogo de roles, catálogo de módulos del dashboard
// y matriz de permisos (qué rol ve qué módulo).
//
// Reemplaza el chequeo hardcodeado que existía en dashboard.html
// (`if (rol === '6') { ocultar grupos... }`) por datos reales en la
// base de datos, administrables desde public/usuarios.html.
'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../config/db');

// --- CATÁLOGO DE ROLES ---
// NOTA: la columna de nombre en c_roles se llama ROL_NAME (no
// ROLE_NAME); la tabla ya existía antes de este módulo con tus 6 roles
// reales (Director General, Gerente Operaciones, etc.), así que no se
// crea ni se siembra aquí, solo se lee/edita.
router.get('/roles', (req, res) => {
  db.query('SELECT ID_ROLE, ROL_NAME, STATUS FROM c_roles ORDER BY ROL_NAME ASC', (err, rows) => {
    if (err) {
      console.error('Error al consultar roles:', err);
      return res.status(500).json({ success: false, message: 'Error al consultar roles.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- ALTA DE ROL ---
// Al crear un rol nuevo se le da acceso por default a todos los
// módulos existentes (igual que el comportamiento histórico del
// sistema para cualquier rol distinto del 6); desde la matriz de
// permisos se puede restringir después.
// La columna USERNAME de c_roles es de auditoría (quién lo dio de
// alta), igual que ya se usa en los roles existentes.
router.post('/roles', (req, res) => {
  const nombre = (req.body.role_name || '').trim();
  const creadoPor = (req.body.creado_por || 'Sistema').trim();
  if (!nombre) return res.status(400).json({ success: false, message: 'El nombre del rol es obligatorio.' });

  db.query('INSERT INTO c_roles (ROL_NAME, USERNAME, STATUS, CREATION_DATE) VALUES (?, ?, 1, NOW())', [nombre, creadoPor], (err, result) => {
    if (err) {
      console.error('Error al crear rol:', err);
      return res.status(500).json({ success: false, message: 'Error al crear el rol.' });
    }
    const idRole = result.insertId;

    db.query(
      `INSERT INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
       SELECT ?, ID_MODULE, 1 FROM c_system_modules`,
      [idRole],
      (err2) => {
        if (err2) {
          console.error('Error al sembrar permisos del rol nuevo:', err2);
          return res.status(500).json({ success: false, message: 'Rol creado, pero hubo un error al asignar permisos iniciales.' });
        }

        db.query(
          `INSERT INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
           SELECT ?, ID_SUBMODULE, 1 FROM c_system_submodules`,
          [idRole],
          (err3) => {
            if (err3) {
              console.error('Error al sembrar permisos de submódulos del rol nuevo:', err3);
              return res.status(500).json({ success: false, message: 'Rol creado, pero hubo un error al asignar permisos iniciales de submódulos.' });
            }
            res.json({ success: true, message: 'Rol creado correctamente.', id_role: idRole });
          }
        );
      }
    );
  });
});

// --- EDITAR ROL (nombre y/o estatus) ---
router.put('/roles/:id', (req, res) => {
  const { id } = req.params;
  const nombre = (req.body.role_name || '').trim();
  const status = req.body.status !== undefined ? parseInt(req.body.status, 10) : null;

  if (!nombre) return res.status(400).json({ success: false, message: 'El nombre del rol es obligatorio.' });

  const query = status === 0 || status === 1
    ? 'UPDATE c_roles SET ROL_NAME = ?, STATUS = ? WHERE ID_ROLE = ?'
    : 'UPDATE c_roles SET ROL_NAME = ? WHERE ID_ROLE = ?';
  const params = status === 0 || status === 1 ? [nombre, status, id] : [nombre, id];

  db.query(query, params, (err) => {
    if (err) {
      console.error('Error al actualizar rol:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el rol.' });
    }
    res.json({ success: true, message: 'Rol actualizado correctamente.' });
  });
});

// --- CATÁLOGO DE MÓDULOS DEL DASHBOARD ---
router.get('/modulos-sistema', (req, res) => {
  db.query('SELECT ID_MODULE, MODULE_KEY, MODULE_LABEL, ORDEN FROM c_system_modules ORDER BY ORDEN ASC', (err, rows) => {
    if (err) {
      console.error('Error al consultar módulos del sistema:', err);
      return res.status(500).json({ success: false, message: 'Error al consultar módulos.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- CATÁLOGO DE SUBMÓDULOS (las opciones dentro de cada grupo del menú) ---
router.get('/submodulos-sistema', (req, res) => {
  const query = `
    SELECT s.ID_SUBMODULE, s.ID_MODULE, s.SUBMODULE_KEY, s.SUBMODULE_LABEL, s.ORDEN, m.MODULE_KEY
    FROM c_system_submodules s
    INNER JOIN c_system_modules m ON m.ID_MODULE = s.ID_MODULE
    ORDER BY m.ORDEN ASC, s.ORDEN ASC`;

  db.query(query, (err, rows) => {
    if (err) {
      console.error('Error al consultar submódulos del sistema:', err);
      return res.status(500).json({ success: false, message: 'Error al consultar submódulos.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- MATRIZ DE PERMISOS DE UN ROL (para la pantalla de administración) ---
router.get('/permisos/:idRole', (req, res) => {
  const { idRole } = req.params;

  const query = `
    SELECT m.ID_MODULE, m.MODULE_KEY, m.MODULE_LABEL, m.ORDEN,
           COALESCE(p.CAN_VIEW, 1) AS CAN_VIEW
    FROM c_system_modules m
    LEFT JOIN role_module_permissions p ON p.ID_MODULE = m.ID_MODULE AND p.ID_ROLE = ?
    ORDER BY m.ORDEN ASC`;

  db.query(query, [idRole], (err, rows) => {
    if (err) {
      console.error('Error al consultar permisos del rol:', err);
      return res.status(500).json({ success: false, message: 'Error al consultar permisos.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- GUARDAR MATRIZ DE PERMISOS DE UN ROL ---
// Body esperado: { permisos: [ { id_module, can_view }, ... ] }
router.put('/permisos/:idRole', (req, res) => {
  const { idRole } = req.params;
  const permisos = Array.isArray(req.body.permisos) ? req.body.permisos : [];

  if (permisos.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron permisos para guardar.' });
  }

  const query = `
    INSERT INTO role_module_permissions (ID_ROLE, ID_MODULE, CAN_VIEW)
    VALUES ?
    ON DUPLICATE KEY UPDATE CAN_VIEW = VALUES(CAN_VIEW)`;

  const valores = permisos.map(p => [idRole, p.id_module, p.can_view ? 1 : 0]);

  db.query(query, [valores], (err) => {
    if (err) {
      console.error('Error al guardar permisos del rol:', err);
      return res.status(500).json({ success: false, message: 'Error al guardar los permisos.' });
    }
    res.json({ success: true, message: 'Permisos actualizados correctamente.' });
  });
});

// --- MATRIZ DE PERMISOS DE SUBMÓDULOS DE UN ROL ---
router.get('/permisos-submodulos/:idRole', (req, res) => {
  const { idRole } = req.params;

  const query = `
    SELECT s.ID_SUBMODULE, s.ID_MODULE, s.SUBMODULE_KEY, s.SUBMODULE_LABEL, s.ORDEN,
           COALESCE(p.CAN_VIEW, 1) AS CAN_VIEW
    FROM c_system_submodules s
    LEFT JOIN role_submodule_permissions p ON p.ID_SUBMODULE = s.ID_SUBMODULE AND p.ID_ROLE = ?
    ORDER BY s.ID_MODULE ASC, s.ORDEN ASC`;

  db.query(query, [idRole], (err, rows) => {
    if (err) {
      console.error('Error al consultar permisos de submódulos:', err);
      return res.status(500).json({ success: false, message: 'Error al consultar permisos.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- GUARDAR MATRIZ DE PERMISOS DE SUBMÓDULOS DE UN ROL ---
// Body esperado: { permisos: [ { id_submodule, can_view }, ... ] }
router.put('/permisos-submodulos/:idRole', (req, res) => {
  const { idRole } = req.params;
  const permisos = Array.isArray(req.body.permisos) ? req.body.permisos : [];

  if (permisos.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron permisos para guardar.' });
  }

  const query = `
    INSERT INTO role_submodule_permissions (ID_ROLE, ID_SUBMODULE, CAN_VIEW)
    VALUES ?
    ON DUPLICATE KEY UPDATE CAN_VIEW = VALUES(CAN_VIEW)`;

  const valores = permisos.map(p => [idRole, p.id_submodule, p.can_view ? 1 : 0]);

  db.query(query, [valores], (err) => {
    if (err) {
      console.error('Error al guardar permisos de submódulos:', err);
      return res.status(500).json({ success: false, message: 'Error al guardar los permisos.' });
    }
    res.json({ success: true, message: 'Permisos actualizados correctamente.' });
  });
});

// --- PERMISOS DEL ROL ACTUAL (usado por dashboard.html al hacer login) ---
// Devuelve solo la lista de MODULE_KEY visibles para ese rol. Si el rol
// no existe en el catálogo (caso raro / dato heredado), se falla-abierto
// devolviendo todos los módulos, igual que el comportamiento histórico
// del sistema para cualquier rol que no fuera el 6.
router.get('/mis-permisos', (req, res) => {
  const idRole = req.query.rol;

  if (!idRole) {
    return res.status(400).json({ success: false, message: 'Falta el parámetro rol.' });
  }

  db.query('SELECT 1 FROM c_roles WHERE ID_ROLE = ?', [idRole], (err, existe) => {
    if (err) {
      console.error('Error al validar rol:', err);
      return res.status(500).json({ success: false, message: 'Error del servidor.' });
    }

    if (existe.length === 0) {
      // Rol desconocido: fail-open (mismo comportamiento que antes de la migración).
      return db.query('SELECT MODULE_KEY FROM c_system_modules', (err2, rows2) => {
        if (err2) return res.status(500).json({ success: false, message: 'Error del servidor.' });
        db.query('SELECT SUBMODULE_KEY FROM c_system_submodules', (err2b, rows2b) => {
          if (err2b) return res.status(500).json({ success: false, message: 'Error del servidor.' });
          res.json({ success: true, modulos: rows2.map(r => r.MODULE_KEY), submodulos: rows2b.map(r => r.SUBMODULE_KEY) });
        });
      });
    }

    const queryModulos = `
      SELECT m.MODULE_KEY
      FROM c_system_modules m
      LEFT JOIN role_module_permissions p ON p.ID_MODULE = m.ID_MODULE AND p.ID_ROLE = ?
      WHERE COALESCE(p.CAN_VIEW, 1) = 1`;

    const querySubmodulos = `
      SELECT s.SUBMODULE_KEY
      FROM c_system_submodules s
      LEFT JOIN role_submodule_permissions p ON p.ID_SUBMODULE = s.ID_SUBMODULE AND p.ID_ROLE = ?
      WHERE COALESCE(p.CAN_VIEW, 1) = 1`;

    db.query(queryModulos, [idRole], (err3, rows3) => {
      if (err3) {
        console.error('Error al consultar mis-permisos:', err3);
        return res.status(500).json({ success: false, message: 'Error del servidor.' });
      }

      db.query(querySubmodulos, [idRole], (err4, rows4) => {
        if (err4) {
          console.error('Error al consultar mis-permisos de submódulos:', err4);
          return res.status(500).json({ success: false, message: 'Error del servidor.' });
        }
        res.json({ success: true, modulos: rows3.map(r => r.MODULE_KEY), submodulos: rows4.map(r => r.SUBMODULE_KEY) });
      });
    });
  });
});

module.exports = router;
