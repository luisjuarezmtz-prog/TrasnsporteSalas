// routes/movimientos.js — Movimientos de viajes (cargos/abonos por operador)
'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../config/db');

// --- RUTA 10: REGISTRAR MOVIMIENTO (CON USUARIO LOGEADO) ---
router.post('/registrar-movimiento', (req, res) => {
  const { fecha, operador, numero, tipo, username } = req.body;

  db.query('SELECT AMOUNT FROM c_type_motions WHERE ID_TYPE_MOTION = ?', [tipo], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ message: 'Error al obtener monto' });

    const monto = results[0].AMOUNT;
    const queryInsert = `
            INSERT INTO travels_movements
            (ID_EMPLOYEE, ID_TYPE_MOTION, MOVEMENT_DATE, NUM_MOVEMENT, AMOUNT, USERNAME, CREATION_DATE)
            VALUES (?, ?, ?, ?, ?, ?, NOW())`;

    db.query(queryInsert, [operador, tipo, fecha, numero, monto, username], (errInsert, result) => {
      if (errInsert) return res.status(500).json({ message: 'Error al guardar movimiento' });
      res.status(200).json({ message: 'Registro exitoso por ' + username, id: result.insertId });
    });
  });
});

// --- RUTA 11: CONSULTAR MOVIMIENTOS CON FILTROS ---
router.get('/consultar-movimientos', (req, res) => {
  const { operador, fechaInicio, fechaFin } = req.query;

  let query = `
        SELECT
            tm.ID_TRAVEL_MOVEMENT,
            CONCAT(e.FIRST_NAME," ",e.MIDDLE_NAME," ",e.PARENTAL_LAST) AS OPERADOR,
            ctm.NAME_MOTION AS TIPO_MOVIMIENTO,
            DATE_FORMAT(tm.MOVEMENT_DATE, '%Y-%m-%d') AS FECHA,
            tm.NUM_MOVEMENT AS FOLIO,
            tm.AMOUNT AS MONTO,
            tm.USERNAME AS REGISTRADO_POR,
            DATE_FORMAT(tm.CREATION_DATE, '%Y-%m-%d') AS FECHA_REGISTRO
        FROM travels_movements tm
        INNER JOIN employees e ON tm.ID_EMPLOYEE = e.ID_EMPLOYEE
        INNER JOIN c_type_motions ctm ON tm.ID_TYPE_MOTION = ctm.ID_TYPE_MOTION
        WHERE 1=1`;

  const params = [];

  if (operador && operador !== '') {
    query += ` AND tm.ID_EMPLOYEE = ?`;
    params.push(operador);
  }

  if (fechaInicio && fechaFin && fechaInicio !== '' && fechaFin !== '') {
    query += ` AND tm.MOVEMENT_DATE BETWEEN ? AND ?`;
    params.push(fechaInicio, fechaFin);
  }

  query += ` ORDER BY tm.MOVEMENT_DATE DESC, tm.ID_TRAVEL_MOVEMENT DESC`;

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error en consulta de movimientos:', err);
      return res.status(500).json({ message: 'Error al consultar la base de datos' });
    }
    res.json(results);
  });
});

// --- RUTA 12: BUSCAR FOLIO CON NOMBRE DE CEDIS ---
router.get('/buscar-folio-factura', (req, res) => {
  const { invoice } = req.query;

  const query = `
        SELECT
            c.CEDI_NAME,
            e.FIRST_NAME,
            e.PARENTAL_LAST,
            DATE_FORMAT(p.DELIVERY_DATE, '%Y-%m-%d') AS FECHA_ENTREGA
        FROM purchases_orders p
        INNER JOIN purchases_orders_historys h ON p.ID_PURCHASE_ORDER = h.ID_PURCHASE_ORDER
        INNER JOIN employees e ON h.ID_EMPLOYEE = e.ID_EMPLOYEE
        INNER JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
        WHERE p.INVOICE_INTER = ?
        ORDER BY h.CREATION_DATE DESC
        LIMIT 1`;

  db.query(query, [invoice], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });

    if (results.length > 0) {
      res.json({
        success: true,
        cedi_name: results[0].CEDI_NAME,
        empleado_nombre: `${results[0].FIRST_NAME} ${results[0].PARENTAL_LAST || ''}`,
        fecha: results[0].FECHA_ENTREGA
      });
    } else {
      res.json({ success: false, message: 'No se encontró historial para esta factura' });
    }
  });
});

module.exports = router;
