// routes/nomina.js — Nómina (payroll), abonos y notificaciones por correo
'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../config/db');
const { transporter, CORREO_ADMIN } = require('../config/mailer');

// --- RUTA 19: GUARDAR NÓMINA CON FOLIO Y NOTIFICACIÓN POR CORREO ---
router.post('/guardar-nomina', (req, res) => {
  const { detalle } = req.body;

  if (!detalle || !Array.isArray(detalle) || detalle.length === 0) {
    return res.status(400).json({ success: false, message: 'Datos no válidos.' });
  }

  // 1. GENERAR FOLIO ÚNICO (Ejemplo: NOM-20260407-8821)
  const ahora = new Date();
  const fechaFolio = ahora.toISOString().split('T')[0].replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  const FOLIO_UNICO = `NOM-${fechaFolio}-${random}`;

  const idsEmpleados = detalle.map(d => d.id_employee);
  const { payment_date, period_start, period_end } = detalle[0];

  // 2. VALIDACIÓN DE DUPLICADOS (evita recalcular el mismo periodo)
  const sqlCheck = `
        SELECT ID_EMPLOYEE FROM payroll
        WHERE ID_EMPLOYEE IN (?) AND PAYMENT_DATE = ? AND PERIOD_START = ? AND PERIOD_END = ?`;

  db.query(sqlCheck, [idsEmpleados, payment_date, period_start, period_end], (err, existing) => {
    if (err) return res.status(500).json({ success: false, message: 'Error de validación.' });
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Esta nómina ya fue registrada anteriormente.' });
    }

    // 3. PREPARAR DATOS PARA INSERT MASIVO
    let montoTotalNomina = 0;
    const values = detalle.map(d => {
      montoTotalNomina += parseFloat(d.net_salary || 0);
      return [
        d.id_employee,
        1, // ID_PSTATUS (Generada)
        FOLIO_UNICO,
        d.payment_date,
        d.period_start,
        d.period_end,
        d.gross_salary || 0,
        d.bonus || 0,
        d.savings_cut || 0,
        d.absences_loans || 0,
        d.net_salary,
        ahora
      ];
    });

    const queryInsert = `
            INSERT INTO payroll
            (ID_EMPLOYEE, ID_PSTATUS, FOLIO, PAYMENT_DATE, PERIOD_START, PERIOD_END,
             GROSS_SALARY, TOTAL_BONUSES, CASHIER_DISCOUNT, DISCOUNT_LOANS_ABSENCES,
             NET_SALARY, CREATION_DATE)
            VALUES ?`;

    db.query(queryInsert, [values], (errInsert) => {
      if (errInsert) {
        console.error('Error al insertar:', errInsert);
        return res.status(500).json({ success: false, message: 'Error al guardar registros.' });
      }

      // 4. ENVIAR NOTIFICACIÓN POR CORREO
      const mailOptions = {
        from: `"Sistema Transportes Salas" <${CORREO_ADMIN}>`,
        to: 'admintransportesalas@gmail.com',
        subject: `💰 Nómina Generada - Folio: ${FOLIO_UNICO}`,
        html: `
                    <div style="font-family: Arial, sans-serif; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #007bff;">✅ Nómina Registrada Exitosamente</h2>
                        <p>Se ha generado un nuevo registro de nómina en el sistema con los siguientes detalles:</p>
                        <hr>
                        <p><b>Folio de Operación:</b> <span style="background: #eee; padding: 5px;">${FOLIO_UNICO}</span></p>
                        <p><b>Fecha de Pago:</b> ${payment_date}</p>
                        <p><b>Periodo:</b> ${period_start} al ${period_end}</p>
                        <p><b>Total de Empleados:</b> ${detalle.length}</p>
                        <p><b>Monto Total Neto:</b> <span style="color: #28a745; font-weight: bold;">$${montoTotalNomina.toFixed(2)}</span></p>
                        <hr>
                        <p style="font-size: 12px; color: #666;">Este es un mensaje automático generado por el Sistema de Transportes Salas.</p>
                    </div>
                `
      };

      transporter.sendMail(mailOptions, (errorMail) => {
        if (errorMail) console.error('Error enviando correo:', errorMail);
      });

      res.json({
        success: true,
        message: `Nómina guardada con Folio: ${FOLIO_UNICO}`,
        folio: FOLIO_UNICO
      });
    });
  });
});

// --- RUTA 20: CONSULTAR NÓMINA POR FOLIO ---
// ANTES el saldo del préstamo (MONTO_PRESTAMO/MONTO_RESTANTE) solo aparecía
// si YA existía un abono en abono_prestamos etiquetado con este mismo folio
// de nómina (INNER JOIN ... AND ap.FOLIO = ?). Eso significa que la PRIMERA
// vez que se abre un folio de nómina nuevo (antes de guardar ningún abono
// bajo ese folio), el préstamo activo del empleado no se mostraba aunque sí
// existiera y tuviera saldo pendiente (por ejemplo el préstamo unificado de
// MAHETZI SALAS). Ahora el saldo del préstamo activo se calcula siempre en
// vivo (monto - abonado), sin depender de ese folio. Por separado se sigue
// consultando si YA se registró un abono para este folio en particular
// (para precargar el campo "Monto Abonar" al reabrir un registro ya
// procesado), pero eso ya no bloquea que se muestre el préstamo.
router.get('/consultar-payroll/:folio', (req, res) => {
  const { folio } = req.params;

  const query = `SELECT
    p.ID_PAYROLL,
    e.FIRST_NAME,
    e.PARENTAL_LAST AS LAST_NAME,
    p.ID_PSTATUS,
    p.PAYMENT_DATE,
    p.PERIOD_START,
    p.PERIOD_END,
    p.GROSS_SALARY,
    p.TOTAL_BONUSES,
    ch.monto  AS CASHIER_DISCOUNT,
    p.DISCOUNT_LOANS_ABSENCES,
    p.INTERESES,
    p.DESCUENTO_VENTA,
    p.NET_SALARY,
    p.STATUS_PAYROLL,
    loan.MONTO_PRESTAMO,
    loan.MONTO_RESTANTE,
    loan.ID_PRESTAMO,
    abonoFolio.MONTO_ABONO
FROM payroll p
INNER JOIN employees e ON p.ID_EMPLOYEE = e.ID_EMPLOYEE
LEFT JOIN (
    -- Préstamo ACTIVO del empleado, con su saldo calculado en vivo
    -- (monto del préstamo - suma de todos sus abonos), sin importar el folio
    -- de nómina que se esté consultando.
    -- IMPORTANTE: se limita a UN solo préstamo por empleado (el más reciente
    -- con ESTATUS = 1) aunque existan datos viejos con más de una fila activa
    -- para el mismo empleado; de lo contrario este JOIN "abre" (multiplica)
    -- la fila del empleado en el resultado, duplicando o triplicando su
    -- registro de nómina en la pantalla de consulta.
    SELECT
        rp.ID_EMPLEADO,
        rp.ID_PRESTAMO,
        rp.MONTO_PRESTAMO,
        (rp.MONTO_PRESTAMO - COALESCE(
            (SELECT SUM(ap2.MONTO_ABONO) FROM abono_prestamos ap2 WHERE ap2.ID_PRESTAMO = rp.ID_PRESTAMO), 0
        )) AS MONTO_RESTANTE
    FROM reg_prestamos rp
    WHERE rp.ESTATUS = 1
      AND rp.ID_PRESTAMO = (
          SELECT MAX(rp2.ID_PRESTAMO)
            FROM reg_prestamos rp2
           WHERE rp2.ID_EMPLEADO = rp.ID_EMPLEADO AND rp2.ESTATUS = 1
      )
) loan ON p.ID_EMPLOYEE = loan.ID_EMPLEADO
LEFT JOIN (
    -- Abono ya registrado especificamente bajo este folio de nomina (si existe),
    -- solo para precargar el campo "Monto Abonar" al reabrir un registro.
    SELECT ap.ID_PRESTAMO, SUM(ap.MONTO_ABONO) AS MONTO_ABONO
    FROM abono_prestamos ap
    WHERE ap.FOLIO = ?
    GROUP BY ap.ID_PRESTAMO
) abonoFolio ON abonoFolio.ID_PRESTAMO = loan.ID_PRESTAMO
LEFT JOIN caja_ahorro ch ON ch.ID_EMPLOYEE = e.ID_EMPLOYEE AND ch.ano = YEAR(CURDATE())
WHERE p.FOLIO = ?`;

  db.query(query, [folio, folio], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Error en el servidor' });

    if (results.length > 0) {
      res.json({ success: true, data: results });
    } else {
      res.json({ success: false, message: 'No se encontraron registros.' });
    }
  });
});

// --- RUTA 21: ACTUALIZAR REGISTRO INDIVIDUAL DE NÓMINA ---
router.put('/actualizar-registro-payroll', (req, res) => {
  const {
    id_payroll, id_pstatus, gross_salary, total_bonuses,
    cashier_discount, discount_loans_absences, interes, ventas, montoabonar, net_salary,
    monto_restante, id_prestamo, monto_prestamo, folio
  } = req.body;

  const queryUpdate = `
        UPDATE payroll
        SET
            ID_PSTATUS = ?,
            GROSS_SALARY = ?,
            TOTAL_BONUSES = ?,
            CASHIER_DISCOUNT = ?,
            DISCOUNT_LOANS_ABSENCES = ?,
            INTERESES = ?,
            DESCUENTO_VENTA = ?,
            ABONO_PRESTAMO = ?,
            NET_SALARY = ?
        WHERE ID_PAYROLL = ?`;

  db.query(queryUpdate, [
    id_pstatus, gross_salary, total_bonuses,
    cashier_discount, discount_loans_absences, interes, ventas, montoabonar, net_salary,
    id_payroll
  ], (err) => {
    if (err) {
      console.error('Error al actualizar nómina:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el registro de nómina' });
    }

    // Aseguramos números válidos para que la resta nunca dé NaN
    const seguroMontoRestante = parseFloat(monto_restante) || 0;
    const seguroMontoAbonar = parseFloat(montoabonar) || 0;
    const monto = seguroMontoRestante - seguroMontoAbonar;

    const queryInsert = `
            INSERT INTO abono_prestamos(id_prestamo, monto_abono, monto_restante, usuario, fecha_creacion,FOLIO)
            VALUES (?, ?, ?, ?, NOW(),?)`;

    const seguroIdPrestamo = parseInt(id_prestamo, 10) || 0;

    if (monto_prestamo != 0) {
      db.query(queryInsert, [seguroIdPrestamo, seguroMontoAbonar, monto, 'System', folio, seguroMontoAbonar, monto], (errInsert) => {
        if (errInsert) {
          console.error('Error al insertar el abono:', errInsert);
          return res.status(500).json({ success: false, message: 'Nómina actualizada, pero ya no se puede registrar un abono.' });
        }

        return res.json({ success: true, message: 'Nómina y abono registrados correctamente' });
      });
    } else {
      return res.json({ success: true, message: 'Nómina registrada correctamente' });
    }
  });
});

// --- RUTA 22: NOTIFICACIÓN MASIVA DE PAGOS SELECCIONADOS ---
// NOTA: el destino ya NO lo decide el frontend (antes venía en el
// body como `destino`); siempre se manda a la cuenta admin del
// sistema (CORREO_ADMIN), que cambia sola según el ambiente
// (Gmail en desarrollo, admin@transportesalas.net en producción).
router.post('/notificar-pago-masivo', (req, res) => {
  const { ids } = req.body;

  if (!ids || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se seleccionaron registros.' });
  }

  const query = `
        SELECT
            p.ID_PAYROLL,
            CONCAT(e.FIRST_NAME, ' ', e.PARENTAL_LAST) AS EMPLEADO,
            p.FOLIO,
            p.NET_SALARY,
            p.CASHIER_DISCOUNT,
            p.INTERESES,
            p.DESCUENTO_VENTA,
            DATE_FORMAT(p.PAYMENT_DATE, '%d/%m/%Y') AS FECHA_PAGO
        FROM payroll p
        INNER JOIN employees e ON p.ID_EMPLOYEE = e.ID_EMPLOYEE
        WHERE p.ID_PAYROLL IN (?)`;

  db.query(query, [ids], (err, results) => {
    if (err) {
      console.error('Error al obtener datos para correo:', err);
      return res.status(500).json({ success: false, message: 'Error al procesar la selección.' });
    }

    let filasTabla = '';
    let totalGeneral = 0;
    let totalcaja = 0;
    let totalinteres = 0;
    let totalventa = 0;

    results.forEach(row => {
      totalGeneral += parseFloat(row.NET_SALARY);
      totalcaja += parseFloat(row.CASHIER_DISCOUNT);
      totalinteres += parseFloat(row.INTERESES);
      totalventa += parseFloat(row.DESCUENTO_VENTA);
      filasTabla += `
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">${row.ID_PAYROLL}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${row.EMPLEADO}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${row.FOLIO}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${parseFloat(row.NET_SALARY).toFixed(2)}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${parseFloat(row.CASHIER_DISCOUNT).toFixed(2)}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${parseFloat(row.INTERESES).toFixed(2)}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${parseFloat(row.DESCUENTO_VENTA).toFixed(2)}</td>
                </tr>`;
    });

    const mailOptions = {
      from: `"Sistema Transportes Salas" <${CORREO_ADMIN}>`,
      to: 'admintransportesalas@gmail.com',
      subject: `📋 Comprobante de Dispersión - ${results.length} Pagos`,
      html: `
                <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
                    <h2 style="color: #2c3e50;">Confirmación de Pagos Realizados</h2>
                    <p>Se ha procesado la notificación de los siguientes registros de nómina:</p>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 8px; border: 1px solid #ddd;">ID</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Empleado</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Folio</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Monto Empleado</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Monto Caja</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Monto Intereses</th>
                                <th style="padding: 8px; border: 1px solid #ddd;">Monto Ventas</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasTabla}
                        </tbody>
                        <tfoot>
                            <tr style="font-weight: bold; background-color: #e9ecef;">
                                <td colspan="3" style="padding: 8px; border: 1px solid #ddd; text-align: right;">TOTAL:</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #198754;">$${totalGeneral.toFixed(2)}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #198754;">$${totalcaja.toFixed(2)}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #198754;">$${totalinteres.toFixed(2)}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #198754;">$${totalventa.toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>
                    <p style="margin-top: 20px; font-size: 12px; color: #777;">
                        Fecha de envío: ${new Date().toLocaleString()}<br>
                        Este es un reporte automático de control administrativo.
                    </p>
                </div>`
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error('Error enviando correo masivo:', error);
        return res.status(500).json({ success: false, message: 'No se pudo enviar el correo.' });
      }
      res.json({ success: true, message: 'Notificación enviada con éxito.' });
    });
  });
});

// --- RUTA 25: CONSULTAR HISTORIAL DE NÓMINAS CON FILTROS ---
// ANTES este listado solo mostraba folios donde TODAS las filas ya estaban
// en ID_PSTATUS = 2 ("Pagada"), por lo que una nómina recién creada
// (ID_PSTATUS = 1, "Generada") nunca aparecía aquí aunque el folio existiera
// y guardar-nomina hubiera respondido success:true. Se quita ese filtro para
// que el resumen muestre TODOS los folios generados, y se agrega
// ESTATUS_GENERAL para saber de un vistazo si el folio ya quedó totalmente
// pagado o todavía tiene registros pendientes de revisión.
router.get('/consultar-nomina-historial', (req, res) => {
  const { fechaInicio, fechaFin } = req.query;

  let query = `
        SELECT
            p.FOLIO,
            DATE_FORMAT(MAX(p.PAYMENT_DATE), '%Y-%m-%d') AS PAYMENT_DATE,
            DATE_FORMAT(MAX(p.PERIOD_START), '%Y-%m-%d') AS PERIOD_START,
            DATE_FORMAT(MAX(p.PERIOD_END), '%Y-%m-%d') AS PERIOD_END,
            COUNT(DISTINCT p.ID_EMPLOYEE) AS TOTAL_EMPLEADOS,
            SUM(p.NET_SALARY) AS MONTO_TOTAL,
            CASE WHEN SUM(CASE WHEN p.ID_PSTATUS <> 2 THEN 1 ELSE 0 END) = 0
                 THEN 'PAGADA' ELSE 'GENERADA' END AS ESTATUS_GENERAL
        FROM payroll p
        WHERE 1=1
    `;

  const queryParams = [];

  if (fechaInicio && fechaFin) {
    query += ` AND DATE(p.PAYMENT_DATE) BETWEEN ? AND ?`;
    queryParams.push(fechaInicio, fechaFin);
  }

  query += ` GROUP BY p.FOLIO`;
  query += ` ORDER BY MAX(p.PAYMENT_DATE) DESC, p.FOLIO DESC`;

  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error('Error al consultar historial agrupado:', err);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
    res.json(results);
  });
});

// --- RUTA 26: ACTUALIZAR CIERRE DE NÓMINA TRAS ENVÍO DE NOTIFICACIÓN ---
// NOTA HISTÓRICA: esta ruta vivía SIN el prefijo /api, montada aparte via
// rootRouter, en teoría para replicar el conexion.js original. Pero el
// frontend (tanto el monolito original como revisarnomina.html) SIEMPRE
// la llamó como '/api/actualizar-payroll', por lo que nunca coincidía con
// ninguna ruta real: la petición fallaba en silencio (404 + JSON.parse
// roto) y el estatus jamás se actualizaba. Se corrige moviéndola aquí, bajo
// el mismo router /api que el resto del módulo.
//
// Además, ahora en vez de bloquear directamente el registro (STATUS_PAYROLL = 1
// = autorizada/final), pasa a un estado intermedio "pendiente de autorización"
// (STATUS_PAYROLL = 2). Desde la nueva pantalla de autorización se decide si
// pasa a autorizada (1) o regresa a editable (0).
//
// CORRECCIÓN: antes esto recibía solo `folio` y actualizaba TODOS los
// registros de ese folio, aunque en Revisar Nómina el usuario hubiera
// seleccionado (y notificado) solo a algunos empleados. Por eso en
// Autorización aparecían empleados que nunca se seleccionaron. Ahora se
// reciben los `ids` (ID_PAYROLL) realmente seleccionados/notificados y
// solo esos pasan a pendiente de autorización.
router.post('/actualizar-payroll', (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No se recibieron registros seleccionados.' });
  }

  const sql = `
        UPDATE payroll
        SET STATUS_PAYROLL = 2
        WHERE ID_PAYROLL IN (?)
    `;

  db.query(sql, [ids], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: err.message });
    }

    res.json({ success: true, affectedRows: result.affectedRows });
  });
});

// --- RUTA 27: CONSULTAR NÓMINAS PENDIENTES DE AUTORIZACIÓN (STATUS_PAYROLL = 2) ---
router.get('/nomina-pendiente-autorizacion', (req, res) => {
  const query = `
        SELECT
            p.ID_PAYROLL,
            p.FOLIO,
            e.FIRST_NAME,
            e.PARENTAL_LAST AS LAST_NAME,
            p.ID_PSTATUS,
            p.PAYMENT_DATE,
            p.PERIOD_START,
            p.PERIOD_END,
            p.GROSS_SALARY,
            p.TOTAL_BONUSES,
            p.CASHIER_DISCOUNT,
            p.DISCOUNT_LOANS_ABSENCES,
            p.INTERESES,
            p.DESCUENTO_VENTA,
            p.NET_SALARY
        FROM payroll p
        INNER JOIN employees e ON p.ID_EMPLOYEE = e.ID_EMPLOYEE
        WHERE p.STATUS_PAYROLL = 2
        ORDER BY p.FOLIO DESC, e.FIRST_NAME ASC`;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al consultar nóminas pendientes de autorización:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    res.json({ success: true, data: results });
  });
});

// --- RUTA 28: AUTORIZAR O RECHAZAR NÓMINA(S) PENDIENTES ---
// accion = 'autorizar' -> STATUS_PAYROLL = 1 (autorizada, final, ya no editable)
// accion = 'rechazar'  -> STATUS_PAYROLL = 0 (regresa a editable/generada)
router.post('/autorizar-nomina', (req, res) => {
  const { ids, accion } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se seleccionaron registros.' });
  }
  if (accion !== 'autorizar' && accion !== 'rechazar') {
    return res.status(400).json({ success: false, message: 'Acción no válida.' });
  }

  const nuevoEstatus = accion === 'autorizar' ? 1 : 0;

  const query = `UPDATE payroll SET STATUS_PAYROLL = ? WHERE ID_PAYROLL IN (?) AND STATUS_PAYROLL = 2`;

  db.query(query, [nuevoEstatus, ids], (err, result) => {
    if (err) {
      console.error('Error al autorizar/rechazar nómina:', err);
      return res.status(500).json({ success: false, message: 'Error al procesar la autorización.' });
    }
    res.json({
      success: true,
      message: accion === 'autorizar'
        ? `${result.affectedRows} registro(s) autorizado(s) correctamente.`
        : `${result.affectedRows} registro(s) rechazado(s) y devueltos a edición.`
    });
  });
});

module.exports = router;

// NOTA: rootRouter se conserva vacío únicamente para no romper el require de
// server.js ('./routes/nomina').rootRouter, que se monta en la raíz. El
// endpoint real de actualizar-payroll ahora vive arriba, bajo /api.
const rootRouter = express.Router();
module.exports.rootRouter = rootRouter;
