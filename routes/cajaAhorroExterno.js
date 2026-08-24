// routes/cajaAhorroExterno.js — Caja de ahorro de Personal Externo
// Mismo patrón que routes/cajaAhorro.js (empleados).
'use strict';

const express = require('express');
const router = express.Router();
const { dbPromesa } = require('../config/db');

router.get('/caja-ahorro-externo', async (req, res) => {
  try {
    const query = `
            SELECT ca.id_caja_ahorro_externo as id, ca.ID_EXTERNO, CONCAT(p.FIRST_NAME, ' ', p.PARENTAL_LAST) AS EXTERNO, monto,
            ano AS fecha
            FROM caja_ahorro_externo ca
            INNER JOIN personal_externo p
             ON ca.ID_EXTERNO = p.ID_EXTERNO
            ORDER BY id_caja_ahorro_externo DESC
        `;
    const [rows] = await dbPromesa.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener cajas de ahorro de personal externo:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.post('/caja-ahorro-externo', async (req, res) => {
  const { externoId, monto, fecha } = req.body;

  if (!externoId || !monto || !fecha) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const query = `
            INSERT INTO caja_ahorro_externo (ID_EXTERNO, monto, ano)
            VALUES (?, ?, ?)
        `;
    const [result] = await dbPromesa.query(query, [externoId, monto, fecha]);

    res.status(201).json({ id: result.insertId, mensaje: 'Caja de ahorro registrada' });
  } catch (error) {
    console.error('Error al insertar caja de ahorro de personal externo:', error);
    res.status(500).json({ error: 'Error al guardar el registro en la base de datos' });
  }
});

router.put('/caja-ahorro-externo/:id', async (req, res) => {
  const idCaja = req.params.id;
  const { externoId, monto, fecha } = req.body;

  try {
    const query = `
            UPDATE caja_ahorro_externo
            SET ID_EXTERNO = ?, monto = ?, ano = ?
            WHERE id_caja_ahorro_externo = ?
        `;
    const [result] = await dbPromesa.query(query, [externoId, monto, fecha, idCaja]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'El registro no existe.' });
    }

    res.json({ mensaje: 'Registro actualizado con éxito' });
  } catch (error) {
    console.error('Error al actualizar caja de ahorro de personal externo:', error);
    res.status(500).json({ error: 'Error al actualizar en la base de datos' });
  }
});

router.delete('/caja-ahorro-externo/:id', async (req, res) => {
  const idCaja = req.params.id;

  try {
    const [result] = await dbPromesa.query('DELETE FROM caja_ahorro_externo WHERE id_caja_ahorro_externo = ?', [idCaja]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No se encontró el registro para eliminar.' });
    }

    res.json({ mensaje: 'Registro eliminado exitosamente.' });
  } catch (error) {
    console.error('Error al eliminar caja de ahorro de personal externo:', error);
    res.status(500).json({ error: 'Error al eliminar de la base de datos' });
  }
});

module.exports = router;
