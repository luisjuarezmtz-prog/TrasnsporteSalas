// routes/catalogosAdmin.js — Alta / edición / baja genérica de catálogos
// del sistema (Cedis, Bancos, Tipos de Movimiento, Tipos de Documento,
// Tipos de Empleado, Tipos de Contrato, Escolaridad, Género).
//
// Por seguridad (evitar inyección SQL vía nombre de tabla/columna) solo
// se permite operar sobre los catálogos listados en CATALOGOS, y solo
// sobre las columnas declaradas en "campos". El front
// (public/catalogos.html) nunca manda el nombre real de la tabla ni de
// las columnas, solo la "key" del catálogo (p. ej. "cedis") y los
// valores; aquí se traduce todo a la tabla/columna real.
//
// Algunos catálogos son más que "nombre + estatus": Cedis, por ejemplo,
// también define el tipo de viaje (Local/Foráneo, usado para separar
// Locales de Foráneos en Cuentas por Cobrar) y los costos por defecto
// que se copian a cada viaje nuevo al registrarse (ver
// routes/viajes.js, POST /registrar-viaje, que copia TRAVEL_COST y
// COST_EXPENSES de c_cedis hacia la nueva orden). Esos campos extra se
// declaran por catálogo en "campos".
'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../config/db');
const { transporter, REMITENTE_DEFAULT, CORREO_ADMIN } = require('../config/mailer');

const CATALOGOS = {
  cedis: {
    label: 'Cedis',
    tabla: 'c_cedis',
    idColumna: 'ID_CEDI',
    nombreColumna: 'CEDI_NAME',
    campos: [
      { columna: 'REGION', label: 'Región', tipo: 'number', paso: '1' },
      {
        columna: 'ID_TYPE_TRIP', label: 'Tipo de Viaje', tipo: 'select',
        opciones: [{ value: 1, label: 'Local' }, { value: 2, label: 'Foráneo' }],
      },
      { columna: 'TRAVEL_COST', label: 'Costo de Viaje', tipo: 'number', paso: '0.01' },
      { columna: 'COST_EXPENSES', label: 'Costo de Gastos', tipo: 'number', paso: '0.01' },
    ],
  },
  bancos: {
    label: 'Bancos',
    tabla: 'c_bancos',
    idColumna: 'ID_BANCO',
    nombreColumna: 'BANCO_NAME',
    campos: [],
  },
  tipos_movimiento: {
    label: 'Tipos de Movimiento',
    tabla: 'c_type_motions',
    idColumna: 'ID_TYPE_MOTION',
    nombreColumna: 'NAME_MOTION',
    campos: [],
  },
  tipos_documento_empleado: {
    label: 'Tipos de Documento (Empleados)',
    tabla: 'c_document_types',
    idColumna: 'ID_DOCUMENT_TYPE',
    nombreColumna: 'DOCUMENT_TYPE_NAME',
    campos: [],
  },
  tipos_documento_proveedor: {
    label: 'Tipos de Documento (Proveedores)',
    tabla: 'c_document_types_proveedor',
    idColumna: 'ID_DOCUMENT_TYPE',
    nombreColumna: 'DOCUMENT_TYPE_NAME',
    campos: [],
  },
  tipos_documento_externo: {
    label: 'Tipos de Documento (Personal Externo)',
    tabla: 'c_document_types_externo',
    idColumna: 'ID_DOCUMENT_TYPE',
    nombreColumna: 'DOCUMENT_TYPE_NAME',
    campos: [],
  },
  tipos_empleado: {
    label: 'Tipos de Empleado',
    tabla: 'c_employee_types',
    idColumna: 'ID_EMPLOYEE_TYPE',
    nombreColumna: 'EMPLOYEE_TYPE_NAME',
    campos: [],
  },
  tipos_contrato: {
    label: 'Tipos de Contrato',
    tabla: 'c_contract_types',
    idColumna: 'ID_CONTRACT_TYPE',
    nombreColumna: 'CONTRACT_TYPE_NAME',
    campos: [],
  },
  escolaridad: {
    label: 'Escolaridad',
    tabla: 'c_educations',
    idColumna: 'ID_EDUCATION',
    nombreColumna: 'EDUCATION_NAME',
    campos: [],
  },
  genero: {
    label: 'Género',
    tabla: 'c_genders',
    idColumna: 'ID_GENDER',
    nombreColumna: 'GENDER_NAME',
    campos: [],
  },
};

function obtenerCatalogo(tipo, res) {
  const cat = CATALOGOS[tipo];
  if (!cat) {
    res.status(400).json({ success: false, message: 'Catálogo no válido.' });
    return null;
  }
  return cat;
}

// Convierte los valores que manda el front ({ REGION: '1010', ... }) en un
// arreglo [valor1, valor2, ...] en el mismo orden que cat.campos, listo
// para usarse como parámetros de una consulta preparada. Los campos
// numéricos vacíos se guardan como 0 (nunca NULL, mismo criterio ya usado
// en el resto del sistema para evitar bugs por NULL).
function extraerValoresCampos(cat, valores) {
  valores = valores || {};
  return cat.campos.map(campo => {
    const crudo = valores[campo.columna];
    if (campo.tipo === 'number' || campo.tipo === 'select') {
      const num = parseFloat(crudo);
      return isNaN(num) ? 0 : num;
    }
    return (crudo ?? '').toString();
  });
}

// --- LISTA DE CATÁLOGOS DISPONIBLES (para el selector del front) ---
// Incluye la definición de "campos" de cada catálogo para que el front
// sepa qué inputs extra debe dibujar (sin necesidad de otro viaje al
// servidor).
router.get('/catalogos-admin/tipos', (req, res) => {
  const tipos = Object.entries(CATALOGOS).map(([key, cat]) => ({
    key, label: cat.label, campos: cat.campos,
  }));
  res.json({ success: true, data: tipos });
});

// --- LISTAR FILAS DE UN CATÁLOGO ---
router.get('/catalogos-admin/:tipo', (req, res) => {
  const cat = obtenerCatalogo(req.params.tipo, res);
  if (!cat) return;

  const columnasExtra = cat.campos.map(c => c.columna).join(', ');
  const sql = `SELECT ${cat.idColumna} AS ID, ${cat.nombreColumna} AS NOMBRE, STATUS${columnasExtra ? ', ' + columnasExtra : ''}
               FROM ${cat.tabla} ORDER BY ${cat.nombreColumna} ASC`;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error(`Error al consultar catálogo ${cat.tabla}:`, err);
      return res.status(500).json({ success: false, message: 'Error al consultar el catálogo.' });
    }
    res.json({ success: true, data: rows });
  });
});

// --- ALTA DE UN VALOR NUEVO ---
router.post('/catalogos-admin/:tipo', (req, res) => {
  const cat = obtenerCatalogo(req.params.tipo, res);
  if (!cat) return;

  const nombre = (req.body.nombre || '').trim();
  if (!nombre) {
    return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
  }

  const columnasExtra = cat.campos.map(c => c.columna);
  const valoresExtra = extraerValoresCampos(cat, req.body.valores);

  const columnas = [cat.nombreColumna, ...columnasExtra, 'STATUS'];
  const marcadores = columnas.map(() => '?').join(', ');
  const sql = `INSERT INTO ${cat.tabla} (${columnas.join(', ')}) VALUES (${marcadores})`;

  db.query(sql, [nombre, ...valoresExtra, 1], (err, result) => {
    if (err) {
      console.error(`Error al insertar en catálogo ${cat.tabla}:`, err);
      return res.status(500).json({ success: false, message: 'Error al guardar. Revisa que no exista ya ese valor.' });
    }
    res.json({ success: true, message: 'Valor agregado correctamente.', id: result.insertId });
  });
});

// --- EDITAR UN VALOR EXISTENTE (nombre + campos extra) ---
router.put('/catalogos-admin/:tipo/:id', (req, res) => {
  const cat = obtenerCatalogo(req.params.tipo, res);
  if (!cat) return;

  const nombre = (req.body.nombre || '').trim();
  if (!nombre) {
    return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
  }

  const columnasExtra = cat.campos.map(c => c.columna);
  const valoresExtra = extraerValoresCampos(cat, req.body.valores);

  const asignaciones = [`${cat.nombreColumna} = ?`, ...columnasExtra.map(col => `${col} = ?`)];
  const sql = `UPDATE ${cat.tabla} SET ${asignaciones.join(', ')} WHERE ${cat.idColumna} = ?`;

  db.query(sql, [nombre, ...valoresExtra, req.params.id], (err) => {
    if (err) {
      console.error(`Error al actualizar catálogo ${cat.tabla}:`, err);
      return res.status(500).json({ success: false, message: 'Error al actualizar. Revisa que no exista ya ese valor.' });
    }
    res.json({ success: true, message: 'Valor actualizado correctamente.' });
  });
});

// --- ACTIVAR / DESACTIVAR UN VALOR ---
router.put('/catalogos-admin/:tipo/:id/estatus', (req, res) => {
  const cat = obtenerCatalogo(req.params.tipo, res);
  if (!cat) return;

  const status = parseInt(req.body.status, 10);
  if (![0, 1].includes(status)) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  const sql = `UPDATE ${cat.tabla} SET STATUS = ? WHERE ${cat.idColumna} = ?`;
  db.query(sql, [status, req.params.id], (err) => {
    if (err) {
      console.error(`Error al cambiar estatus en catálogo ${cat.tabla}:`, err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
    }
    res.json({ success: true, message: status === 1 ? 'Valor activado correctamente.' : 'Valor desactivado correctamente.' });
  });
});

// --- PRUEBA DE ENVÍO DE CORREO (diagnóstico de configuración SMTP) ---
router.post('/test-email', async (req, res) => {
  const destinatario = (req.body.destinatario || CORREO_ADMIN || '').trim();
  if (!destinatario) {
    return res.status(400).json({ success: false, message: 'Falta el correo destinatario.' });
  }

  try {
    await transporter.sendMail({
      from: REMITENTE_DEFAULT,
      to: destinatario,
      subject: 'Prueba de envío de correo — Transportes Salas',
      text: `Correo de prueba enviado el ${new Date().toLocaleString('es-MX')} para verificar la configuración SMTP.`,
    });
    res.json({ success: true, message: `Correo de prueba enviado a ${destinatario}.` });
  } catch (error) {
    console.error('Error al enviar correo de prueba:', error);
    res.status(500).json({ success: false, message: `Error al enviar: ${error.message}` });
  }
});

module.exports = router;
