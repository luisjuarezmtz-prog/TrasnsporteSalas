// routes/auth.js — Autenticación de usuarios
'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../config/db');

// Detecta si un valor guardado en PASSWORD ya es un hash de bcrypt
// (siempre empieza con $2a$, $2b$ o $2y$) en vez de texto plano.
function esHashBcrypt(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$/.test(valor);
}

// --- RUTA 1: LOGIN ---
// NOTA: no hay sesión/token de servidor, solo se responde el rol para
// que el frontend lo guarde en localStorage. Eso queda pendiente de una
// fase de seguridad aparte (sesión real / JWT).
//
// La contraseña puede venir en dos formatos en la base de datos:
//   - Hash de bcrypt (usuarios dados de alta o reseteados desde el
//     nuevo módulo de Usuarios y Roles) -> se valida con bcrypt.compare.
//   - Texto plano (usuarios antiguos que aún no se han migrado) -> se
//     compara tal cual, igual que se hacía antes.
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Usuario y contraseña son obligatorios.' });
  }

  const query = 'SELECT * FROM users U inner join dw_employees de on U.ID_DW_EMPLOYEE= de.ID_DW_EMPLOYEE WHERE USERNAME = ?';
  db.execute(query, [username], async (err, results) => {
    if (err) {
      console.error('Error de consulta en /api/login:', err.code, err.message);
      return res.status(500).json({ message: 'Error en el servidor' });
    }
    if (results.length === 0) return res.status(401).json({ message: 'Credenciales incorrectas' });

    const user = results[0];

    try {
      const claveValida = esHashBcrypt(user.PASSWORD)
        ? await bcrypt.compare(password, user.PASSWORD)
        : password === user.PASSWORD;

      if (!claveValida) return res.status(401).json({ message: 'Credenciales incorrectas' });
      if (parseInt(user.STATUS) === 0) return res.status(403).json({ message: 'Usuario inactivo' });

      return res.status(200).json({ message: 'Bienvenido', user: user.USERNAME, rol: user.ID_ROLE });
    } catch (error) {
      console.error('Error al validar contraseña:', error);
      return res.status(500).json({ message: 'Error en el servidor' });
    }
  });
});

module.exports = router;
