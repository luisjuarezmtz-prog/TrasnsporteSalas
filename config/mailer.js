// config/mailer.js — Transporte de correo (Nodemailer)
'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');

// En producción no se puede usar Gmail (bloqueado/no disponible), así
// que ahí se usa un relay SMTP local (Postfix/sendmail escuchando en
// localhost:25) con la cuenta admin@transportesalas.net. En desarrollo
// se sigue usando Gmail con la cuenta de siempre
// (admintransportesalas@gmail.com). Se controla con MAIL_TRANSPORT en
// el .env de cada ambiente:
//   MAIL_TRANSPORT=local  -> localhost:25 + admin@transportesalas.net (producción)
//   (sin definir, o cualquier otro valor) -> Gmail + admintransportesalas@gmail.com (desarrollo)
const usarSmtpLocal = process.env.MAIL_TRANSPORT === 'local';

// Cuenta de correo "oficial" del sistema para esta ejecución: distinta
// según el ambiente, salvo que se sobreescriba explícitamente con
// MAIL_USER en el .env.
const CORREO_ADMIN = process.env.MAIL_USER || (usarSmtpLocal ? 'admin@transportesalas.net' : 'admintransportesalas@gmail.com');

const transporter = usarSmtpLocal
  ? nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: {
        rejectUnauthorized: false
      }
    })
  : nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: CORREO_ADMIN,
        pass: process.env.MAIL_PASSWORD || ''
      }
    });

const REMITENTE_DEFAULT = `"Transportes Salas" <${CORREO_ADMIN}>`;

module.exports = { transporter, REMITENTE_DEFAULT, CORREO_ADMIN };
