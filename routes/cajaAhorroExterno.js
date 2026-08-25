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
            ano AS fecha, COALESCE(ab.TOTAL_ABONADO, 0) AS total_abonado
            FROM caja_ahorro_externo ca
            INNER JOIN personal_externo p
             ON ca.ID_EXTERNO = p.ID_EXTERNO
            LEFT JOIN (
                SELECT ID_CAJA_AHORRO_EXTERNO, SUM(MONTO_ABONO) AS TOTAL_ABONADO
                FROM caja_ahorro_externo_abonos
                GROUP BY ID_CAJA_AHORRO_EXTERNO
            ) ab ON ab.ID_CAJA_AHORRO_EXTERNO = ca.id_caja_ahorro_externo
            ORDER BY ca.id_caja_ahorro_externo DESC
        `;
    const [rows] = await dbPromesa.query(query);
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener cajas de ahorro de personal externo:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// --- ABONOS A LA CAJA DE AHORRO (registro manual, Personal Externo no
// tiene nómina que descuente sola cada periodo) ---
router.get('/caja-ahorro-externo/:id/abonos', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      'SELECT ID_ABONO, MONTO_ABONO, USUARIO, FECHA_CREACION FROM caja_ahorro_externo_abonos WHERE ID_CAJA_AHORRO_EXTERNO = ? ORDER BY FECHA_CREACION DESC',
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al consultar abonos de caja de ahorro:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.post('/caja-ahorro-externo/:id/abono', async (req, res) => {
  const { id } = req.params;
  const monto = parseFloat(req.body.monto);
  const username = req.body.username || 'Sistema';

  if (!(monto > 0)) {
    return res.status(400).json({ error: 'El monto del abono debe ser mayor a 0.' });
  }

  try {
    const [result] = await dbPromesa.query(
      'INSERT INTO caja_ahorro_externo_abonos (ID_CAJA_AHORRO_EXTERNO, MONTO_ABONO, USUARIO, FECHA_CREACION) VALUES (?, ?, ?, NOW())',
      [id, monto, username]
    );
    res.status(201).json({ id: result.insertId, mensaje: 'Abono registrado correctamente.' });
  } catch (error) {
    console.error('Error al registrar abono de caja de ahorro:', error);
    res.status(500).json({ error: 'Error al guardar el abono en la base de datos' });
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
    await dbPromesa.query('DELETE FROM caja_ahorro_externo_abonos WHERE ID_CAJA_AHORRO_EXTERNO = ?', [idCaja]);
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
