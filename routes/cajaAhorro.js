// routes/cajaAhorro.js — Caja de ahorro de empleados
'use strict';

const express = require('express');
const router = express.Router();
const { dbPromesa } = require('../config/db');

router.get('/caja-ahorro', async (req, res) => {
  try {
    const query = `
            SELECT ca.id_caja_ahorro as id, ca.ID_EMPLOYEE,  CONCAT(e.FIRST_NAME, ' ', e.PARENTAL_LAST) AS EMPLEADO, monto,
            ano AS fecha
            FROM caja_ahorro ca
            INNER JOIN employees e
             ON ca.id_employee = e.ID_EMPLOYEE
            ORDER BY id_caja_ahorro DESC
        `;
    const [rows] = await dbPromesa.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener cajas de ahorro:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.post('/caja-ahorro', async (req, res) => {
  const { empleadoId, monto, fecha } = req.body;

  if (!empleadoId || !monto || !fecha) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const query = `
            INSERT INTO caja_ahorro (ID_EMPLOYEE, monto, ano)
            VALUES (?, ?, ?)
        `;
    const [result] = await dbPromesa.query(query, [empleadoId, monto, fecha]);

    res.status(201).json({ id: result.insertId, mensaje: 'Caja de ahorro registrada' });
  } catch (error) {
    console.error('Error al insertar caja de ahorro:', error);
    res.status(500).json({ error: 'Error al guardar el registro en la base de datos' });
  }
});

router.put('/caja-ahorro/:id', async (req, res) => {
  const idCaja = req.params.id;
  const { empleadoId, monto, fecha } = req.body;

  try {
    const query = `
            UPDATE caja_ahorro
            SET ID_EMPLOYEE = ?, monto = ?, ano = ?
            WHERE id_caja_ahorro = ?
        `;
    const [result] = await dbPromesa.query(query, [empleadoId, monto, fecha, idCaja]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'El registro no existe.' });
    }

    res.json({ mensaje: 'Registro actualizado con éxito' });
  } catch (error) {
    console.error('Error al actualizar caja de ahorro:', error);
    res.status(500).json({ error: 'Error al actualizar en la base de datos' });
  }
});

router.delete('/caja-ahorro/:id', async (req, res) => {
  const idCaja = req.params.id;

  try {
    const [result] = await dbPromesa.query('DELETE FROM caja_ahorro WHERE id_caja_ahorro = ?', [idCaja]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No se encontró el registro para eliminar.' });
    }

    res.json({ mensaje: 'Registro eliminado exitosamente.' });
  } catch (error) {
    console.error('Error al eliminar caja de ahorro:', error);
    res.status(500).json({ error: 'Error al eliminar de la base de datos' });
  }
});

module.exports = router;
