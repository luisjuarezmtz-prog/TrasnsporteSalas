// routes/tarimas.js — Registro e historial de tarimas (pallets)
'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db } = require('../config/db');

// --- RUTA 13: REGISTRAR EN PALLETS_REGISTRATIONS ---
router.post('/registrar-tarimas-final', (req, res) => {
  const {
    folio_factura,
    num_tarimas,
    num_vales,
    usuario_que_registra
  } = req.body;

  const queryBusqueda = `
        SELECT p.ID_CEDI, h.ID_EMPLOYEE, p.DELIVERY_DATE
        FROM purchases_orders p
        INNER JOIN purchases_orders_historys h ON p.ID_PURCHASE_ORDER = h.ID_PURCHASE_ORDER
        WHERE p.INVOICE_INTER = ?
        ORDER BY h.CREATION_DATE DESC LIMIT 1`;

  db.query(queryBusqueda, [folio_factura], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ success: false, message: 'No se encontraron datos de origen.' });
    }

    const { ID_CEDI, ID_EMPLOYEE, DELIVERY_DATE } = results[0];

    const queryInsertPrincipal = `
            INSERT INTO pallets_registrations
            (INVOICE_INTER, ID_CEDI, ID_EMPLOYEE, DELIVERY_DATE, NUM_TARIMAS, NUM_VALE, USERNAME, CREATION_DATE)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;

    db.query(queryInsertPrincipal, [folio_factura, ID_CEDI, ID_EMPLOYEE, DELIVERY_DATE, num_tarimas, num_vales, usuario_que_registra], (errReg, resReg) => {
      if (errReg) {
        console.error(errReg);
        return res.status(500).json({ success: false, message: 'Error al crear registro principal.' });
      }

      const nuevoIdRegistro = resReg.insertId;

      const queryHistorial = `
                INSERT INTO pallets_registrations_history
                (ID_PALLET_REGISTRATION, ID_EMPLOYEE, NUM_TARIMAS, NUM_VALE, USERNAME, CREATION_DATE)
                VALUES (?, ?, ?, ?, ?, NOW())`;

      db.query(queryHistorial, [nuevoIdRegistro, ID_EMPLOYEE, num_tarimas, num_vales, usuario_que_registra], (errHist) => {
        if (errHist) {
          console.error('Error en historial:', errHist);
        }

        res.json({
          success: true,
          message: 'Registro e Historial guardados correctamente.',
          id: nuevoIdRegistro
        });
      });
    });
  });
});

// --- RUTA 14: OBTENER UN REGISTRO DE PALLETS POR FOLIO (PARA EDICIÓN) ---
router.get('/obtener-registro-pallets', (req, res) => {
  const { invoice } = req.query;

  const sql = `
        SELECT
            r.ID_PALLET_REGISTRATION as id,
            r.INVOICE_INTER as invoice,
            r.ID_EMPLOYEE as id_employee,
            r.NUM_TARIMAS as tarimas,
            r.NUM_VALE as vales,
            r.FALTANTE_TARIMA as faltantes,
            c.CEDI_NAME as cedi_name
        FROM pallets_registrations r
        LEFT JOIN c_cedis c ON r.ID_CEDI = c.ID_CEDI
        WHERE r.INVOICE_INTER = ?
        LIMIT 1`;

  db.query(sql, [invoice], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });

    if (results.length > 0) {
      res.json({
        success: true,
        ...results[0]
      });
    } else {
      res.json({ success: false, message: 'No encontrado' });
    }
  });
});

// --- RUTA 15: ACTUALIZAR REGISTRO DE PALLETS Y GENERAR HISTORIAL ---
router.put('/actualizar-registro-pallets', (req, res) => {
  const { id_registration, id_employee, num_tarimas, num_vales, username, faltantes } = req.body;

  const sqlUpdate = `
        UPDATE pallets_registrations
        SET TARIMAS_VALE = ?, NUM_VALE = ?, USERNAME = ?, CREATION_DATE = NOW(), FALTANTE_TARIMA = ?
        WHERE ID_PALLET_REGISTRATION = ?`;

  db.query(sqlUpdate, [num_tarimas, num_vales, username, faltantes, id_registration], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Error al actualizar registro principal' });
    }

    const sqlHistory = `
            INSERT INTO pallets_registrations_history
            (ID_PALLET_REGISTRATION, ID_EMPLOYEE, NUM_TARIMAS, NUM_VALE, USERNAME, CREATION_DATE)
            VALUES (?, ?, ?, ?, ?, NOW())`;

    db.query(sqlHistory, [id_registration, id_employee, num_tarimas, num_vales, username], (errHist) => {
      if (errHist) {
        console.error('Error al guardar historial de edición:', errHist);
      }

      res.json({
        success: true,
        message: 'Registro actualizado e historial generado correctamente.'
      });
    });
  });
});

// --- RUTA 16: CONSULTAR CON FILTRO CEDIS Y FOLIO ---
router.get('/historial-pallets', (req, res) => {
  const { folio, cediId } = req.query;

  let query = `
        SELECT
            PR.INVOICE_INTER AS FOLIO_FACTURA,
            CD.CEDI_NAME AS CEDI,
            E.FIRST_NAME AS NOMBRE,
            DATE_FORMAT(PR.DELIVERY_DATE, '%Y-%m-%d') AS FECHA_ENTREGA,
            PRG.NUM_TARIMAS,
            PRG.NUM_VALE,
            PRG.USERNAME AS USUARIO,
            DATE_FORMAT(PRG.CREATION_DATE, '%Y-%m-%d %H:%i:%s') AS FECHA
        FROM pallets_registrations_history PRG
        LEFT JOIN pallets_registrations PR ON PR.ID_PALLET_REGISTRATION = PRG.ID_PALLET_REGISTRATION
        LEFT JOIN c_cedis CD ON CD.ID_CEDI = PR.ID_CEDI
        LEFT JOIN employees E ON PRG.ID_EMPLOYEE = E.ID_EMPLOYEE
        WHERE 1=1`;

  const params = [];
  if (folio) {
    query += ` AND PR.INVOICE_INTER LIKE ? `;
    params.push(`%${folio}%`);
  }
  if (cediId && cediId !== 'TODOS') {
    query += ` AND CD.ID_CEDI = ?`;
    params.push(cediId);
  }

  query += ` ORDER BY PRG.CREATION_DATE ASC`;

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json(results);
  });
});

// --- RUTA 17: EXPORTAR HISTORIAL CON FILTROS (FOLIO Y CEDIS) ---
router.get('/exportar-historial-pallets', async (req, res) => {
  const { folio, cediId } = req.query;

  let query = `
        SELECT
            PR.INVOICE_INTER AS 'FOLIO_FACTURA',
            CD.CEDI_NAME AS 'CEDI',
            E.FIRST_NAME AS 'NOMBRE_EMPLEADO',
            DATE_FORMAT(PR.DELIVERY_DATE, '%Y-%m-%d') AS 'FECHA_ENTREGA',
            PRG.NUM_TARIMAS AS 'TARIMAS',
            PRG.NUM_VALE AS 'VALES',
            PRG.USERNAME AS 'MODIFICADO_POR',
            DATE_FORMAT(PRG.CREATION_DATE, '%Y-%m-%d %H:%i:%s') AS 'FECHA_MOVIMIENTO'
        FROM pallets_registrations_history PRG
        LEFT JOIN pallets_registrations PR ON PR.ID_PALLET_REGISTRATION = PRG.ID_PALLET_REGISTRATION
        LEFT JOIN c_cedis CD ON CD.ID_CEDI = PR.ID_CEDI
        LEFT JOIN employees E ON PRG.ID_EMPLOYEE = E.ID_EMPLOYEE
        WHERE 1=1`;

  const params = [];

  if (folio && folio.trim() !== '') {
    query += ` AND PR.INVOICE_INTER LIKE ?`;
    params.push(`%${folio}%`);
  }

  if (cediId && cediId !== 'TODOS') {
    query += ` AND CD.ID_CEDI = ?`;
    params.push(cediId);
  }

  query += ` ORDER BY PRG.CREATION_DATE DESC`;

  db.query(query, params, async (err, rows) => {
    if (err) {
      console.error('Error en Excel:', err);
      return res.status(500).send('Error al obtener datos para el reporte');
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Historial de Pallets');

      worksheet.columns = [
        { header: 'Folio Factura', key: 'FOLIO_FACTURA', width: 20 },
        { header: 'CEDI', key: 'CEDI', width: 20 },
        { header: 'Empleado', key: 'NOMBRE_EMPLEADO', width: 25 },
        { header: 'F. Entrega', key: 'FECHA_ENTREGA', width: 15 },
        { header: 'Tarimas', key: 'TARIMAS', width: 10 },
        { header: 'Vales', key: 'VALES', width: 10 },
        { header: 'Modificado por', key: 'MODIFICADO_POR', width: 20 },
        { header: 'Fecha Movimiento', key: 'FECHA_MOVIMIENTO', width: 25 }
      ];

      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF007BFF' }
      };

      worksheet.addRows(rows);

      let filename = 'Reporte_Historial';
      if (folio) filename += `_Folio_${folio}`;
      if (cediId !== 'TODOS') filename += `_CEDI_${cediId}`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      res.status(500).send('Error al generar el archivo Excel');
    }
  });
});

module.exports = router;
