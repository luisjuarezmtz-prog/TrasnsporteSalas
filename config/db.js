// config/db.js — Conexión a la base de datos MySQL
'use strict';

require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'devop',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'DB_SALAS',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const dbPromesa = db.promise();

module.exports = { db, dbPromesa };
