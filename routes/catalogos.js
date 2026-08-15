// routes/catalogos.js — Catálogos de apoyo (empleados, estatus, cedis, tipos de movimiento)
'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../config/db');

// --- RUTA 2: CATÁLOGOS (EMPLEADOS Y ESTATUS) ---
// NOTA: antes se armaba el nombre con CONCAT(FIRST_NAME," ",MIDDLE_NAME," ",PARENTAL_LAST).
// CONCAT en MySQL regresa NULL si CUALQUIERA de sus argumentos es NULL, y
// MIDDLE_NAME (segundo nombre) suele venir vacío/NULL para muchos empleados.
// Eso hacía que NAME llegara como null al frontend y tronara en
// consultarviajes.html (`e.NAME.split(' ')` sobre null). CONCAT_WS ignora
// los argumentos NULL en vez de propagar NULL, y TRIM limpia espacios extra
// cuando falta el primer o el último nombre.
router.get('/empleados', (req, res) => {
  db.query("SELECT ID_EMPLOYEE, TRIM(CONCAT_WS(' ', FIRST_NAME, MIDDLE_NAME, PARENTAL_LAST)) AS NAME, salary as salario FROM employees WHERE STATUS = 1 ORDER BY FIRST_NAME ASC", (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

router.get('/empleados_operadores', (req, res) => {
  db.query("SELECT ID_EMPLOYEE, TRIM(CONCAT_WS(' ', FIRST_NAME, MIDDLE_NAME, PARENTAL_LAST)) AS NAME, salary as salario FROM employees WHERE STATUS = 1 and operador = 1 ORDER BY FIRST_NAME ASC", (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

router.get('/estatus', (req, res) => {
  db.query('SELECT ID_STATUS_ORDER, STATUS_NAME FROM status_orders ORDER BY STATUS_NAME ASC', (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// --- RUTA 6: OBTENER CATÁLOGO DE CEDIS ---
router.get('/cedis', (req, res) => {
  db.query('SELECT ID_CEDI, CEDI_NAME FROM c_cedis WHERE STATUS = 1 ORDER BY CEDI_NAME ASC', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// --- RUTA 9: CATÁLOGO DE MOVIMIENTOS ---
router.get('/tipos-movimientos', (req, res) => {
  db.query('SELECT ID_TYPE_MOTION, NAME_MOTION FROM c_type_motions WHERE STATUS = 1 ORDER BY NAME_MOTION ASC', (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

module.exports = router;
