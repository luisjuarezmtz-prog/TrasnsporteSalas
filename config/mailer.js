// config/mailer.js — Transporte de correo (Nodemailer)
'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');

// En producción no se puede usar Gmail (bloqueado/no disponible), así
// que ahí se usa el SMTP de Hostinger con la cuenta admin@transportesalas.net.
// En desarrollo se sigue usando Gmail con la cuenta de siempre
// (admintransportesalas@gmail.com). Se controla con MAIL_TRANSPORT en
// el .env de cada ambiente:
//   MAIL_TRANSPORT=smtp   -> SMTP genérico (MAIL_HOST/MAIL_PORT/MAIL_SECURE) + admin@transportesalas.net (producción, Hostinger)
//   MAIL_TRANSPORT=local  -> localhost:25 (solo si el host permite correr un relay propio)
//   (sin definir, o cualquier otro valor) -> Gmail + admintransportesalas@gmail.com (desarrollo)
const usarSmtpGenerico = process.env.MAIL_TRANSPORT === 'smtp';
const usarSmtpLocal = process.env.MAIL_TRANSPORT === 'local';

// Cuenta de correo "oficial" del sistema para esta ejecución: distinta
// según el ambiente, salvo que se sobreescriba explícitamente con
// MAIL_USER en el .env.
const CORREO_ADMIN = process.env.MAIL_USER || ((usarSmtpGenerico || usarSmtpLocal) ? 'admin@transportesalas.net' : 'admintransportesalas@gmail.com');

let transporter;
if (usarSmtpGenerico) {
  const port = Number(process.env.MAIL_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.hostinger.com',
    port,
    secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : port === 465,
    auth: {
      user: CORREO_ADMIN,
      pass: process.env.MAIL_PASSWORD || ''
    }
  });
} else if (usarSmtpLocal) {
  transporter = nodemailer.createTransport({
    host: 'localhost',
    port: 25,
    secure: false,
    tls: {
      rejectUnauthorized: false
    }
  });
} else {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: CORREO_ADMIN,
      pass: process.env.MAIL_PASSWORD || ''
    }
  });
}

const REMITENTE_DEFAULT = `"Transportes Salas" <${CORREO_ADMIN}>`;

module.exports = { transporter, REMITENTE_DEFAULT, CORREO_ADMIN };
