// routes/reportes.js — Reportes administrativos: Préstamos y Caja de Ahorro
// de Empleados y Personal Externo (con su interés cuando aplica).
//
// Cada ruta soporta ?formato=excel para descargar el mismo resultado como
// .xlsx (mismo patrón que exportarViajes en routes/viajes.js), en vez de
// duplicar la consulta en un endpoint aparte.
'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { dbPromesa } = require('../config/db');

async function responderReporte(res, formato, nombreHoja, encabezados, filas) {
  if (formato !== 'excel') {
    return res.json({ success: true, data: filas });
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(nombreHoja);
  worksheet.addRow(encabezados.map(h => h.label));
  filas.forEach(fila => worksheet.addRow(encabezados.map(h => fila[h.key])));
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach(col => { col.width = 20; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${nombreHoja}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
}

// --- REPORTE: PRÉSTAMOS DE EMPLEADOS (con interés cobrado en nómina) ---
// El interés de empleados no vive en la tabla del préstamo (a diferencia de
// personal externo): se cobra como renglón de nómina (payroll.INTERESES,
// ver revisarnomina.html) cada vez que se procesa un periodo con préstamo
// activo. Aquí se suma el interés de nómina del mismo empleado dentro del
// mismo rango de fechas del filtro (por PAYMENT_DATE), para que quede
// consistente con qué préstamos se están mostrando.
router.get('/reportes/prestamos-empleados', async (req, res) => {
  const { fechaInicio, fechaFin, empleado, formato } = req.query;

  const condiciones = [];
  const params = [];
  if (fechaInicio && fechaFin) {
    condiciones.push('R.FECHA_CREACION BETWEEN ? AND ?');
    params.push(fechaInicio, fechaFin);
  }
  if (empleado) {
    condiciones.push('R.ID_EMPLEADO = ?');
    params.push(empleado);
  }
  const whereSql = condiciones.length ? `AND ${condiciones.join(' AND ')}` : '';

  const interesCondiciones = [];
  const interesParams = [];
  if (fechaInicio && fechaFin) {
    interesCondiciones.push('P.PAYMENT_DATE BETWEEN ? AND ?');
    interesParams.push(fechaInicio, fechaFin);
  }
  const interesWhereSql = interesCondiciones.length ? `WHERE ${interesCondiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT
          R.ID_PRESTAMO,
          R.FOLIO,
          CONCAT(E.FIRST_NAME, ' ', E.PARENTAL_LAST) AS PERSONA,
          R.MONTO_PRESTAMO,
          COALESCE(G.MONTO_ABONADO, 0) AS MONTO_ABONADO,
          COALESCE(I.INTERES_TOTAL, 0) AS INTERES,
          (R.MONTO_PRESTAMO - COALESCE(G.MONTO_ABONADO, 0)) AS MONTO_RESTANTE,
          CASE WHEN R.ESTATUS = 1 THEN 'Activo' ELSE 'Cerrado' END AS ESTATUS,
          DATE_FORMAT(R.FECHA_CREACION, '%Y-%m-%d') AS FECHA
       FROM reg_prestamos R
       LEFT JOIN employees E ON E.ID_EMPLOYEE = R.ID_EMPLEADO
       LEFT JOIN (
           SELECT ID_PRESTAMO, SUM(MONTO_ABONO) AS MONTO_ABONADO
           FROM abono_prestamos GROUP BY ID_PRESTAMO
       ) G ON G.ID_PRESTAMO = R.ID_PRESTAMO
       LEFT JOIN (
           SELECT P.ID_EMPLOYEE, SUM(P.INTERESES) AS INTERES_TOTAL
           FROM payroll P
           ${interesWhereSql}
           GROUP BY P.ID_EMPLOYEE
       ) I ON I.ID_EMPLOYEE = R.ID_EMPLEADO
       WHERE 1=1 ${whereSql}
       ORDER BY R.FECHA_CREACION DESC`,
      [...interesParams, ...params]
    );

    await responderReporte(res, formato, 'Prestamos_Empleados', [
      { key: 'FOLIO', label: 'Folio' },
      { key: 'PERSONA', label: 'Empleado' },
      { key: 'MONTO_PRESTAMO', label: 'Monto Préstamo' },
      { key: 'MONTO_ABONADO', label: 'Monto Abonado' },
      { key: 'INTERES', label: 'Interés (nómina, mismo periodo)' },
      { key: 'MONTO_RESTANTE', label: 'Monto Restante' },
      { key: 'ESTATUS', label: 'Estatus' },
      { key: 'FECHA', label: 'Fecha' },
    ], filas);
  } catch (err) {
    console.error('Error al generar reporte de préstamos de empleados:', err);
    res.status(500).json({ success: false, message: 'Error al generar el reporte.' });
  }
});

// --- REPORTE: PRÉSTAMOS DE PERSONAL EXTERNO (con su interés) ---
router.get('/reportes/prestamos-externos', async (req, res) => {
  const { fechaInicio, fechaFin, externo, formato } = req.query;

  const condiciones = [];
  const params = [];
  if (fechaInicio && fechaFin) {
    condiciones.push('R.FECHA_CREACION BETWEEN ? AND ?');
    params.push(fechaInicio, fechaFin);
  }
  if (externo) {
    condiciones.push('R.ID_EXTERNO = ?');
    params.push(externo);
  }
  const whereSql = condiciones.length ? `AND ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT
          R.ID_PRESTAMO,
          R.FOLIO,
          CONCAT(P.FIRST_NAME, ' ', P.PARENTAL_LAST) AS PERSONA,
          R.MONTO_PRESTAMO,
          COALESCE(G.MONTO_ABONADO, 0) AS MONTO_ABONADO,
          COALESCE(G.INTERES_TOTAL, 0) AS INTERES,
          (R.MONTO_PRESTAMO + COALESCE(G.INTERES_TOTAL, 0) - COALESCE(G.MONTO_ABONADO, 0)) AS MONTO_RESTANTE,
          CASE WHEN R.ESTATUS = 1 THEN 'Activo' ELSE 'Cerrado' END AS ESTATUS,
          DATE_FORMAT(R.FECHA_CREACION, '%Y-%m-%d') AS FECHA
       FROM reg_prestamos_externos R
       LEFT JOIN personal_externo P ON P.ID_EXTERNO = R.ID_EXTERNO
       LEFT JOIN (
           SELECT ID_PRESTAMO, SUM(MONTO_ABONO) AS MONTO_ABONADO, SUM(INTERES) AS INTERES_TOTAL
           FROM abono_prestamos_externos GROUP BY ID_PRESTAMO
       ) G ON G.ID_PRESTAMO = R.ID_PRESTAMO
       WHERE 1=1 ${whereSql}
       ORDER BY R.FECHA_CREACION DESC`,
      params
    );

    await responderReporte(res, formato, 'Prestamos_Personal_Externo', [
      { key: 'FOLIO', label: 'Folio' },
      { key: 'PERSONA', label: 'Personal Externo' },
      { key: 'MONTO_PRESTAMO', label: 'Monto Préstamo' },
      { key: 'MONTO_ABONADO', label: 'Monto Abonado' },
      { key: 'INTERES', label: 'Interés' },
      { key: 'MONTO_RESTANTE', label: 'Monto Restante' },
      { key: 'ESTATUS', label: 'Estatus' },
      { key: 'FECHA', label: 'Fecha' },
    ], filas);
  } catch (err) {
    console.error('Error al generar reporte de préstamos de personal externo:', err);
    res.status(500).json({ success: false, message: 'Error al generar el reporte.' });
  }
});

// --- REPORTE: CAJA DE AHORRO DE EMPLEADOS ---
router.get('/reportes/caja-ahorro-empleados', async (req, res) => {
  const { anioInicio, anioFin, empleado, formato } = req.query;

  const condiciones = [];
  const params = [];
  if (anioInicio && anioFin) {
    condiciones.push('CA.ano BETWEEN ? AND ?');
    params.push(anioInicio, anioFin);
  }
  if (empleado) {
    condiciones.push('CA.ID_EMPLOYEE = ?');
    params.push(empleado);
  }
  const whereSql = condiciones.length ? `AND ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT
          CONCAT(E.FIRST_NAME, ' ', E.PARENTAL_LAST) AS PERSONA,
          CA.ano AS ANIO,
          CA.monto AS MONTO
       FROM caja_ahorro CA
       LEFT JOIN employees E ON E.ID_EMPLOYEE = CA.ID_EMPLOYEE
       WHERE 1=1 ${whereSql}
       ORDER BY CA.ano DESC, PERSONA ASC`,
      params
    );

    await responderReporte(res, formato, 'Caja_Ahorro_Empleados', [
      { key: 'PERSONA', label: 'Empleado' },
      { key: 'ANIO', label: 'Año' },
      { key: 'MONTO', label: 'Monto Asignado' },
    ], filas);
  } catch (err) {
    console.error('Error al generar reporte de caja de ahorro de empleados:', err);
    res.status(500).json({ success: false, message: 'Error al generar el reporte.' });
  }
});

// --- REPORTE: CAJA DE AHORRO DE PERSONAL EXTERNO (con total abonado) ---
router.get('/reportes/caja-ahorro-externos', async (req, res) => {
  const { anioInicio, anioFin, externo, formato } = req.query;

  const condiciones = [];
  const params = [];
  if (anioInicio && anioFin) {
    condiciones.push('CA.ano BETWEEN ? AND ?');
    params.push(anioInicio, anioFin);
  }
  if (externo) {
    condiciones.push('CA.ID_EXTERNO = ?');
    params.push(externo);
  }
  const whereSql = condiciones.length ? `AND ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT
          CONCAT(P.FIRST_NAME, ' ', P.PARENTAL_LAST) AS PERSONA,
          CA.ano AS ANIO,
          CA.monto AS MONTO,
          COALESCE(AB.TOTAL_ABONADO, 0) AS TOTAL_ABONADO
       FROM caja_ahorro_externo CA
       LEFT JOIN personal_externo P ON P.ID_EXTERNO = CA.ID_EXTERNO
       LEFT JOIN (
           SELECT ID_CAJA_AHORRO_EXTERNO, SUM(MONTO_ABONO) AS TOTAL_ABONADO
           FROM caja_ahorro_externo_abonos GROUP BY ID_CAJA_AHORRO_EXTERNO
       ) AB ON AB.ID_CAJA_AHORRO_EXTERNO = CA.id_caja_ahorro_externo
       WHERE 1=1 ${whereSql}
       ORDER BY CA.ano DESC, PERSONA ASC`,
      params
    );

    await responderReporte(res, formato, 'Caja_Ahorro_Personal_Externo', [
      { key: 'PERSONA', label: 'Personal Externo' },
      { key: 'ANIO', label: 'Año' },
      { key: 'MONTO', label: 'Monto Asignado' },
      { key: 'TOTAL_ABONADO', label: 'Total Abonado' },
    ], filas);
  } catch (err) {
    console.error('Error al generar reporte de caja de ahorro de personal externo:', err);
    res.status(500).json({ success: false, message: 'Error al generar el reporte.' });
  }
});

module.exports = router;
