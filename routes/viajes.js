// routes/viajes.js — Órdenes de compra / viajes
'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db, dbPromesa } = require('../config/db');
const { transporter, REMITENTE_DEFAULT } = require('../config/mailer');

// --- RUTA 3: CONSULTAR VIAJES ---
router.get('/consultar-viajes', (req, res) => {
  const { estatus, fechaInicio, fechaFin, pagoInicio, pagoFin } = req.query;

  let query = `
        SELECT
            p.ID_PURCHASE_ORDER,
            p.PURCHASE_ORDER AS ORDEN_COMPRA,
            p.INVOICE_INTER AS FOLIO_FACTURA,
            p.ORDER_DATE AS FECHA_ORDEN,
            p.DELIVERY_DATE AS FECHA_ENTREGA,
            p.DELIVERY_TIME,
            p.PAYMENT_DATE AS FECHA_PAGO,
            COALESCE(c.CEDI_NAME, 'Sin CEDIS') AS CEDIS,
            COALESCE(tt.TYPE, 'No definido') AS TIPO_VIAJE,
            st.STATUS_NAME AS ESTATUS,
            COALESCE(p.TRAVEL_COST, 0) AS MONTO_VIAJE,
            COALESCE(p.COST_EXPENSES, 0) AS MONTO_GASTOS,
            p.NUM_TOTOPOS,
            p.NUM_TOSTADAS,
            p.TOTAL_TARIMAS,
            (SELECT emp.FIRST_NAME FROM purchases_orders_historys h
             INNER JOIN employees emp ON h.ID_EMPLOYEE = emp.ID_EMPLOYEE
             WHERE h.ID_PURCHASE_ORDER = p.ID_PURCHASE_ORDER
             ORDER BY h.ID_PURCHASE_ORDER_HISTORY DESC LIMIT 1) AS EMPLEADO,
             p.FISICO
        FROM purchases_orders p
        LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
        LEFT JOIN c_type_of_trip tt ON c.ID_TYPE_TRIP = tt.ID_TYPE_TRIP
        LEFT JOIN status_orders st ON p.ID_STATUS_ORDER = st.ID_STATUS_ORDER
        WHERE 1=1`;

  const queryParams = [];
  if (estatus && estatus.toUpperCase() !== 'TODOS') {
    query += ` AND st.STATUS_NAME = ?`;
    queryParams.push(estatus);
  }
  if (fechaInicio && fechaFin) {
    query += ` AND p.DELIVERY_DATE BETWEEN ? AND ?`;
    queryParams.push(fechaInicio, fechaFin);
  }
  if (pagoInicio && pagoFin) {
    query += ` AND p.PAYMENT_DATE BETWEEN ? AND ?`;
    queryParams.push(pagoInicio, pagoFin);
  }

  query += ` ORDER BY p.ID_PURCHASE_ORDER DESC`;

  db.query(query, queryParams, (err, results) => {
    if (err) return res.status(500).json({ message: 'Error en la base de datos', error: err.message });
    res.json(results);
  });
});

router.put('/actualizar-viaje-Check/:id', (req, res) => {
  const { id } = req.params;
  let { fisico, usuario_logeado } = req.body;

  const queryUpdate = `
        UPDATE purchases_orders
        SET FISICO = ?
        WHERE ID_PURCHASE_ORDER = ?`;

  db.query(queryUpdate, [fisico, id], (err, result) => {
    if (err) {
      console.error('Error SQL:', err); // Se imprime en consola para depurar
      return res.status(500).json({ message: 'Error al actualizar registro' });
    }

    return res.status(200).json({
      success: true,
      message: 'Estado físico actualizado correctamente'
    });
  });
});

// --- RUTA 4: ACTUALIZAR VIAJE ---
router.put('/actualizar-viaje/:id', (req, res) => {
  const { id } = req.params;
  let {
    purchase_order, invoice_inter, order_date, delivery_date,
    delivery_time, payment_date, num_totopos, num_tostadas,
    estatus, empleado, usuario_logeado
  } = req.body;
  empleado = empleado?.trim().split(/\s+/)[0] || '';

  const cleanDate = (d) => (d && d !== '' && d !== 'null') ? new Date(d).toISOString().split('T')[0] : null;

  const queryUpdate = `
        UPDATE purchases_orders
        SET PURCHASE_ORDER = ?, INVOICE_INTER = ?, ORDER_DATE = ?,
            DELIVERY_DATE = ?, DELIVERY_TIME = ?, PAYMENT_DATE = ?,
            NUM_TOTOPOS = ?, NUM_TOSTADAS = ?, TOTAL_TARIMAS = ?,
            ID_STATUS_ORDER = (SELECT ID_STATUS_ORDER FROM status_orders WHERE TRIM(STATUS_NAME) = ? LIMIT 1)
        WHERE ID_PURCHASE_ORDER = ?`;

  const totopos = parseInt(num_totopos) || 0;
  const tostadas = parseInt(num_tostadas) || 0;

  db.query(queryUpdate, [
    purchase_order, invoice_inter, cleanDate(order_date), cleanDate(delivery_date),
    delivery_time || null, cleanDate(payment_date), totopos, tostadas,
    (totopos + tostadas), estatus.trim(), id
  ], (err) => {
    if (err) return res.status(500).json({ message: 'Error al actualizar registro' });

    const finalizarYResponder = () => {
      const queryHist = `
                INSERT INTO purchases_orders_historys (ID_PURCHASE_ORDER, ID_EMPLOYEE, STATUS_ORDER, USERNAME, CREATION_DATE)
                VALUES (?, (SELECT ID_EMPLOYEE FROM employees WHERE TRIM(FIRST_NAME) = ? LIMIT 1),
                    (SELECT ID_STATUS_ORDER FROM status_orders WHERE TRIM(STATUS_NAME) = ? LIMIT 1), ?, NOW())`;

      db.query(queryHist, [id, empleado.trim(), estatus.trim(), usuario_logeado || 'Sistema'], () => {
        res.status(200).json({ message: 'Actualizado con éxito' });
      });
    };

    const esAsignado = estatus.trim().toLowerCase() === 'asignado';
    const tieneEmpleado = empleado && empleado.trim() !== '' && empleado.trim().toLowerCase() !== 'null';

    if (esAsignado && tieneEmpleado) {
      const queryAgenda = `
                INSERT INTO agenda_eventos (ID_PURCHASE_ORDER, ORDEN_COMPRA, FECHA_ENTREGA, HORA_ENTREGA, CEDIS, EMPLEADO, ESTATUS)
                SELECT p.ID_PURCHASE_ORDER, p.PURCHASE_ORDER, p.DELIVERY_DATE, p.DELIVERY_TIME, c.CEDI_NAME, ?, ?
                FROM purchases_orders p
                LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
                WHERE p.ID_PURCHASE_ORDER = ?
                ON DUPLICATE KEY UPDATE
                    ORDEN_COMPRA = VALUES(ORDEN_COMPRA), FECHA_ENTREGA = VALUES(FECHA_ENTREGA),
                    HORA_ENTREGA = VALUES(HORA_ENTREGA), CEDIS = VALUES(CEDIS), EMPLEADO = VALUES(EMPLEADO), ESTATUS = VALUES(ESTATUS)`;

      db.query(queryAgenda, [empleado.trim(), estatus.trim(), id], (errAg) => {
        const queryDataCorreo = `
                    SELECT COALESCE(c.CEDI_NAME, 'No especificado') AS NOMBRE_CEDIS, e.mail, e.first_name as nombre,date_format(p.delivery_date,'%Y-%m-%d') as fecha_entrega, p.delivery_time as hora_entrega
                    FROM purchases_orders p
                    LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
                    LEFT JOIN employees e ON TRIM(e.FIRST_NAME) = ?
                    WHERE p.ID_PURCHASE_ORDER = ? LIMIT 1`;

        db.query(queryDataCorreo, [empleado.trim(), id], (errData, results) => {
          if (!errData && results.length > 0 && results[0].mail) {
            const info = results[0];
            const mailOptions = {
              from: REMITENTE_DEFAULT,
              to: info.mail,
              subject: `Nuevo viaje asignado: ${purchase_order}`,
              html: `<h2>🚚 Nuevo Viaje Asignado</h2><p>Hola ${info.nombre}, se te ha asignado la orden: <b>${purchase_order}</b></p><p>CEDIS: ${info.NOMBRE_CEDIS}</p><p><b>Entrega: ${info.fecha_entrega}</b> a las: ${info.hora_entrega}</p>`
            };
            transporter.sendMail(mailOptions);
          }
          finalizarYResponder();
        });
      });
    } else {
      finalizarYResponder();
    }
  });
});

// --- RUTA 5: OBTENER DATOS DE LA AGENDA ---
router.get('/agenda', (req, res) => {
  db.query(`SELECT * FROM agenda_eventos`, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// --- RUTA 7: REGISTRAR NUEVO VIAJE ---
router.post('/registrar-viaje', (req, res) => {
  const {
    purchase_order, order_date, delivery_date, payment_date,
    delivery_time, num_totopos, num_tostada, id_cedi, username
  } = req.body;

  const totalTarimas = (parseInt(num_totopos) || 0) + (parseInt(num_tostada) || 0);
  const claveValor = 20626;

  const queryInsertPrincipal = `
        INSERT INTO purchases_orders
        (PURCHASE_ORDER, ORDER_DATE, DELIVERY_DATE, PAYMENT_DATE, DELIVERY_TIME,
         NUM_TOTOPOS, NUM_TOSTADAS, TOTAL_TARIMAS, ID_CEDI, ID_STATUS_ORDER,
         USERNAME, CLAVE, TRAVEL_COST, COST_EXPENSES, CREATION_DATE)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, TRAVEL_COST, COST_EXPENSES, NOW()
        FROM c_cedis
        WHERE ID_CEDI = ?`;

  db.query(queryInsertPrincipal, [
    purchase_order, order_date, delivery_date, payment_date, delivery_time,
    num_totopos, num_tostada, totalTarimas, id_cedi, username, claveValor, id_cedi
  ], (err, result) => {
    if (err) return res.status(500).json({ message: 'Error al registrar viaje' });
    const nuevoIdViaje = result.insertId;
    const queryHistorial = `
            INSERT INTO purchases_orders_historys (ID_PURCHASE_ORDER, ID_EMPLOYEE, STATUS_ORDER, USERNAME, CREATION_DATE)
            VALUES (?, NULL, 1, ?, NOW())`;
    db.query(queryHistorial, [nuevoIdViaje, username], () => {
      res.status(200).json({ message: 'Viaje registrado con éxito', id: nuevoIdViaje });
    });
  });
});

async function exportarViajes(query, params, res, nombreHoja = 'Viajes') {
  db.query(query, params, async (err, rows) => {
    if (err) return res.status(500).send('Error al obtener datos');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(nombreHoja);
    worksheet.addRow(['ID', 'Orden', 'Factura', 'F. Orden', 'F. Entrega', 'CEDIS', 'Estatus', 'Monto', 'Gasto', 'Empleado']);
    rows.forEach(row => worksheet.addRow(Object.values(row)));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Reporte.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  });
}

const SQL_EXPORTAR_VIAJES = `SELECT p.ID_PURCHASE_ORDER AS 'ID', p.PURCHASE_ORDER AS 'Orden', p.INVOICE_INTER AS 'Factura',
                    p.ORDER_DATE AS 'F_Orden', p.DELIVERY_DATE AS 'F_Entrega', c.CEDI_NAME AS 'CEDIS',
                    s.STATUS_NAME AS 'Estatus' , p.TRAVEL_COST AS 'Monto', p.COST_EXPENSES AS 'Gasto',
                    (SELECT emp.FIRST_NAME FROM purchases_orders_historys h
             INNER JOIN employees emp ON h.ID_EMPLOYEE = emp.ID_EMPLOYEE
             WHERE h.ID_PURCHASE_ORDER = p.ID_PURCHASE_ORDER
             ORDER BY h.ID_PURCHASE_ORDER_HISTORY DESC LIMIT 1) AS EMPLEADO
                    FROM purchases_orders p
                    LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
                    LEFT JOIN status_orders s ON p.ID_STATUS_ORDER = s.ID_STATUS_ORDER WHERE 1=1`;

// --- RUTA 8: EXPORTAR A EXCEL (por fecha de entrega) ---
router.get('/exportar-excel', async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    const query = `${SQL_EXPORTAR_VIAJES} AND p.DELIVERY_DATE BETWEEN ? AND ?`;
    await exportarViajes(query, [fechaInicio, fechaFin], res);
  } catch (e) { res.status(500).send('Error'); }
});

// --- RUTA 24: EXPORTAR A EXCEL (por fecha de pago) ---
router.get('/exportar-excel-pago', async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    const query = `${SQL_EXPORTAR_VIAJES} AND p.PAYMENT_DATE BETWEEN ? AND ?`;
    await exportarViajes(query, [fechaInicio, fechaFin], res);
  } catch (e) { res.status(500).send('Error'); }
});

// --- RUTA 23: VALIDA ORDEN DE COMPRA ---
router.get('/valida-orden-compra', (req, res) => {
  const id_compra = req.query.id_compra;
  const query = 'select PURCHASE_ORDER from purchases_orders where PURCHASE_ORDER = ?';
  db.query(query, [id_compra], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) {
      res.json({ existe: false });
    } else {
      res.json({ existe: true });
    }
  });
});

// --- RUTA 18: DASHBOARD — resumen agregado de viajes para "Resumen General" ---
// Ingresos/gastos excluyen viajes CANCELADO, mismo criterio que ya usa
// consultarviajes.html al sumar sus totales en el cliente.
router.get('/dashboard-resumen', async (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  if (!fechaInicio || !fechaFin) {
    return res.status(400).json({ success: false, message: 'Faltan fechaInicio/fechaFin.' });
  }
  const rango = [fechaInicio, fechaFin];

  try {
    const [
      [totalesRows],
      [porEstatus],
      [porTipo],
      [porDia],
      [porCedi],
      [porEmpleado]
    ] = await Promise.all([
      dbPromesa.query(
        `SELECT
            COUNT(*) AS viajes,
            COALESCE(SUM(CASE WHEN COALESCE(st.STATUS_NAME,'') != 'CANCELADO' THEN p.TRAVEL_COST ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN COALESCE(st.STATUS_NAME,'') != 'CANCELADO' THEN p.COST_EXPENSES ELSE 0 END), 0) AS gastos
         FROM purchases_orders p
         LEFT JOIN status_orders st ON p.ID_STATUS_ORDER = st.ID_STATUS_ORDER
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?`,
        rango
      ),
      dbPromesa.query(
        `SELECT st.STATUS_NAME AS estatus, COUNT(p.ID_PURCHASE_ORDER) AS total
         FROM purchases_orders p
         LEFT JOIN status_orders st ON p.ID_STATUS_ORDER = st.ID_STATUS_ORDER
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?
         GROUP BY st.ID_STATUS_ORDER, st.STATUS_NAME
         ORDER BY st.ID_STATUS_ORDER ASC`,
        rango
      ),
      dbPromesa.query(
        `SELECT COALESCE(tt.TYPE, 'No definido') AS tipo, COUNT(p.ID_PURCHASE_ORDER) AS total
         FROM purchases_orders p
         LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
         LEFT JOIN c_type_of_trip tt ON c.ID_TYPE_TRIP = tt.ID_TYPE_TRIP
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?
         GROUP BY tt.ID_TYPE_TRIP, tt.TYPE`,
        rango
      ),
      dbPromesa.query(
        `SELECT p.DELIVERY_DATE AS fecha,
            COALESCE(SUM(CASE WHEN COALESCE(st.STATUS_NAME,'') != 'CANCELADO' THEN p.TRAVEL_COST ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN COALESCE(st.STATUS_NAME,'') != 'CANCELADO' THEN p.COST_EXPENSES ELSE 0 END), 0) AS gastos
         FROM purchases_orders p
         LEFT JOIN status_orders st ON p.ID_STATUS_ORDER = st.ID_STATUS_ORDER
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?
         GROUP BY p.DELIVERY_DATE
         ORDER BY p.DELIVERY_DATE ASC`,
        rango
      ),
      dbPromesa.query(
        `SELECT COALESCE(c.CEDI_NAME, 'Sin CEDIS') AS cedi, COUNT(p.ID_PURCHASE_ORDER) AS total
         FROM purchases_orders p
         LEFT JOIN c_cedis c ON p.ID_CEDI = c.ID_CEDI
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?
         GROUP BY c.ID_CEDI, c.CEDI_NAME
         ORDER BY total DESC
         LIMIT 5`,
        rango
      ),
      // Empleado asignado = el más reciente en purchases_orders_historys
      // para esa orden (mismo criterio que la subconsulta EMPLEADO de
      // GET /consultar-viajes). Los viajes sin empleado asignado todavía
      // (ID_EMPLOYEE NULL, p.ej. recién capturados) quedan fuera por el
      // INNER JOIN, ya que no hay a quién atribuírselos.
      dbPromesa.query(
        `SELECT emp.FIRST_NAME AS empleado, COUNT(*) AS total
         FROM purchases_orders p
         INNER JOIN purchases_orders_historys h ON h.ID_PURCHASE_ORDER = p.ID_PURCHASE_ORDER
           AND h.ID_PURCHASE_ORDER_HISTORY = (
             SELECT MAX(h2.ID_PURCHASE_ORDER_HISTORY) FROM purchases_orders_historys h2
             WHERE h2.ID_PURCHASE_ORDER = p.ID_PURCHASE_ORDER
           )
         INNER JOIN employees emp ON h.ID_EMPLOYEE = emp.ID_EMPLOYEE
         WHERE p.DELIVERY_DATE BETWEEN ? AND ?
         GROUP BY emp.ID_EMPLOYEE, emp.FIRST_NAME
         ORDER BY total DESC
         LIMIT 5`,
        rango
      )
    ]);

    res.json({
      success: true,
      totales: totalesRows[0] || { viajes: 0, ingresos: 0, gastos: 0 },
      porEstatus,
      porTipo,
      porDia,
      porCedi,
      porEmpleado
    });
  } catch (err) {
    console.error('Error al generar resumen de viajes:', err);
    res.status(500).json({ success: false, message: 'Error al generar el resumen.' });
  }
});

module.exports = router;
