// routes/usuarios.js — Alta, edición, baja/reactivación y reseteo de
// contraseña de los usuarios que pueden iniciar sesión en el sistema.
//
// Cómo está relacionado esto en la base de datos (confirmado con el
// cliente, no es una suposición):
//   users (ID_USER, USERNAME, PASSWORD, MAIL, STATUS, ID_DW_EMPLOYEE)
//     -> dw_employees (ID_DW_EMPLOYEE, ID_EMPLOYEE, ID_ROLE)
//          -> employees (ID_EMPLOYEE, FIRST_NAME, ...)  [nombre real]
//          -> c_roles   (ID_ROLE, ROL_NAME)             [rol real]
//
// Es decir: el rol NO vive en `users`, vive en `dw_employees`. Por eso
// dar de alta o cambiar el rol de un usuario en realidad busca/crea el
// registro correspondiente en dw_employees para el empleado elegido y
// le asigna ahí el ID_ROLE (ver resolverDwEmployee más abajo).
//
// NOTA de seguridad: los usuarios que se dan de alta o a los que se les
// resetea la contraseña desde aquí quedan con PASSWORD encriptado con
// bcrypt. Los usuarios que ya existían antes de este módulo siguen
// entrando con su contraseña en texto plano hasta que alguien les
// resetee la contraseña (routes/auth.js soporta ambos formatos).
'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { dbPromesa } = require('../config/db');

const SALT_ROUNDS = 10;

// Busca si el empleado ya tiene un registro en dw_employees; si lo
// tiene, le actualiza el rol y lo reutiliza. Si no, crea uno nuevo.
// idEmployee puede venir null (cuenta de sistema sin empleado ligado).
async function resolverDwEmployee(idEmployee, idRole) {
  if (idEmployee) {
    const [filas] = await dbPromesa.query(
      'SELECT ID_DW_EMPLOYEE FROM dw_employees WHERE ID_EMPLOYEE = ?',
      [idEmployee]
    );
    if (filas.length > 0) {
      const idDwEmployee = filas[0].ID_DW_EMPLOYEE;
      await dbPromesa.query('UPDATE dw_employees SET ID_ROLE = ? WHERE ID_DW_EMPLOYEE = ?', [idRole, idDwEmployee]);
      return idDwEmployee;
    }
  }

  const [resultado] = await dbPromesa.query(
    'INSERT INTO dw_employees (ID_EMPLOYEE, ID_ROLE, CREATION_DATE) VALUES (?, ?, NOW())',
    [idEmployee || null, idRole]
  );
  return resultado.insertId;
}

// --- CONSULTA DE USUARIOS (con nombre de empleado y de rol) ---
router.get('/usuarios', async (req, res) => {
  try {
    const query = `
      SELECT
        u.ID_USER, u.USERNAME, u.MAIL, u.STATUS, u.ID_DW_EMPLOYEE,
        dwe.ID_EMPLOYEE, dwe.ID_ROLE,
        r.ROL_NAME,
        TRIM(CONCAT_WS(' ', e.FIRST_NAME, e.MIDDLE_NAME, e.PARENTAL_LAST, e.MOTHER_LAST)) AS EMPLEADO_NOMBRE
      FROM users u
      LEFT JOIN dw_employees dwe ON dwe.ID_DW_EMPLOYEE = u.ID_DW_EMPLOYEE
      LEFT JOIN c_roles r ON r.ID_ROLE = dwe.ID_ROLE
      LEFT JOIN employees e ON e.ID_EMPLOYEE = dwe.ID_EMPLOYEE
      ORDER BY u.USERNAME ASC`;

    const [rows] = await dbPromesa.query(query);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar usuarios:', error);
    res.status(500).json({ success: false, message: 'Error al consultar usuarios.' });
  }
});

// --- CATÁLOGOS PARA EL FORMULARIO DE ALTA/EDICIÓN DE USUARIOS ---
// El catálogo de empleados NO incluye a los que ya están ligados a otro
// usuario (vía dw_employees), para no poder asignar el mismo empleado
// dos veces. Al editar un usuario se manda ?excluir_usuario=<ID_USER>
// para que su propio empleado ligado siga apareciendo en su combo
// (si no, desaparecería de la lista al estar "tomado" por sí mismo).
router.get('/usuarios-catalogos', async (req, res) => {
  const excluirUsuario = parseInt(req.query.excluir_usuario, 10) || 0;

  try {
    const [roles] = await dbPromesa.query('SELECT ID_ROLE, ROL_NAME FROM c_roles WHERE STATUS = 1 ORDER BY ROL_NAME ASC');
    const [empleados] = await dbPromesa.query(
      `SELECT e.ID_EMPLOYEE, e.FIRST_NAME, e.MIDDLE_NAME, e.PARENTAL_LAST, e.MOTHER_LAST, e.STATUS
       FROM employees e
       WHERE e.ID_EMPLOYEE NOT IN (
         SELECT dwe.ID_EMPLOYEE
         FROM dw_employees dwe
         INNER JOIN users u ON u.ID_DW_EMPLOYEE = dwe.ID_DW_EMPLOYEE
         WHERE dwe.ID_EMPLOYEE IS NOT NULL AND u.ID_USER <> ?
       )
       ORDER BY e.FIRST_NAME ASC`,
      [excluirUsuario]
    );
    res.json({ success: true, roles, empleados });
  } catch (error) {
    console.error('Error al consultar catálogos de usuario:', error);
    res.status(500).json({ success: false, message: 'Error al consultar catálogos.' });
  }
});

// --- ALTA DE USUARIO ---
router.post('/usuarios', async (req, res) => {
  const { username, password, mail, id_role, id_employee } = req.body;

  if (!username || !password || !mail || !id_role) {
    return res.status(400).json({ success: false, message: 'Usuario, contraseña, correo y rol son obligatorios.' });
  }

  try {
    const idDwEmployee = await resolverDwEmployee(id_employee || null, id_role);
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const [resultado] = await dbPromesa.query(
      'INSERT INTO users (USERNAME, PASSWORD, MAIL, STATUS, ID_DW_EMPLOYEE) VALUES (?, ?, ?, 1, ?)',
      [username.trim(), hash, mail.trim(), idDwEmployee]
    );

    res.json({ success: true, message: 'Usuario creado correctamente.', id_user: resultado.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Ese nombre de usuario ya existe.' });
    }
    console.error('Error al dar de alta usuario:', error);
    res.status(500).json({ success: false, message: 'Error al registrar el usuario.' });
  }
});

// --- EDITAR USUARIO (rol / empleado ligado / correo; NO la contraseña) ---
router.put('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { id_role, id_employee, mail } = req.body;

  if (!id_role || !mail) {
    return res.status(400).json({ success: false, message: 'Rol y correo son obligatorios.' });
  }

  try {
    const idDwEmployee = await resolverDwEmployee(id_employee || null, id_role);

    await dbPromesa.query(
      'UPDATE users SET MAIL = ?, ID_DW_EMPLOYEE = ? WHERE ID_USER = ?',
      [mail.trim(), idDwEmployee, id]
    );

    res.json({ success: true, message: 'Usuario actualizado correctamente.' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el usuario.' });
  }
});

// --- BAJA / REACTIVACIÓN DE USUARIO (STATUS 1 = activo, 0 = baja) ---
router.put('/usuarios/:id/estatus', async (req, res) => {
  const { id } = req.params;
  const status = parseInt(req.body.status, 10);

  if (status !== 0 && status !== 1) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  try {
    await dbPromesa.query('UPDATE users SET STATUS = ? WHERE ID_USER = ?', [status, id]);
    res.json({
      success: true,
      message: status === 1 ? 'Usuario reactivado correctamente.' : 'Usuario dado de baja correctamente.'
    });
  } catch (error) {
    console.error('Error al cambiar estatus del usuario:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
  }
});

// --- RESET DE CONTRASEÑA (queda encriptada con bcrypt a partir de aquí) ---
router.put('/usuarios/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 4) {
    return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 4 caracteres.' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await dbPromesa.query('UPDATE users SET PASSWORD = ? WHERE ID_USER = ?', [hash, id]);
    res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('Error al resetear contraseña:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la contraseña.' });
  }
});

module.exports = router;
