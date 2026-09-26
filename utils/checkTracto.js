// utils/checkTracto.js — Catálogo del Check de Unidad (Tracto Camión)
//
// A diferencia del Check de Caja Seca, donde los componentes son una
// lista plana, aquí cada vista tiene su propio conjunto de puntos a
// revisar (formato FORM-CTC-01). Este archivo es la única fuente de esa
// lista: routes/trailerChecks.js valida contra ella y también la sirve
// al navegador, para que la pantalla no tenga una copia que se pueda
// desincronizar.
'use strict';

const VISTAS = ['LATERAL_IZQUIERDA', 'LATERAL_DERECHA', 'FRONTAL', 'TRASERA', 'SUPERIOR'];

const VISTA_LABEL = {
  LATERAL_IZQUIERDA: 'Vista lateral izquierda',
  LATERAL_DERECHA: 'Vista lateral derecha',
  FRONTAL: 'Vista frontal',
  TRASERA: 'Vista trasera',
  SUPERIOR: 'Vista superior',
};

// Los dos laterales revisan exactamente los mismos puntos.
const COMPONENTES_LATERAL = [
  'Cabina / Puertas',
  'Cristales / Espejos',
  'Defensa',
  'Cofre / Motor',
  'Llantas (delanteras)',
  'Llantas (traseras)',
  'Tanque de diésel',
  'Estribos',
  'Caja de herramientas',
  'Faldones / Laterales',
  'Chasis',
  'Otros (especificar)',
];

const COMPONENTES_POR_VISTA = {
  LATERAL_IZQUIERDA: COMPONENTES_LATERAL,
  LATERAL_DERECHA: COMPONENTES_LATERAL,
  FRONTAL: [
    'Cristal delantero',
    'Espejos',
    'Defensa',
    'Parrilla',
    'Cofre / Motor',
    'Luces (altas / bajas / direccionales)',
    'Limpia parabrisas',
    'Llantas delanteras',
    'Otros (especificar)',
  ],
  TRASERA: [
    'Cabina (parte trasera)',
    'Luces traseras',
    'Defensa',
    'Llantas (traseras)',
    'Deflectores',
    'Mangueras / Conexiones',
    'Faldones',
    'Chasis',
    'Otros (especificar)',
  ],
  SUPERIOR: [
    'Techo',
    'Espejos',
    'Cabina',
    'Chasis',
    'Llantas',
    'Fifth wheel',
    'Otros (especificar)',
  ],
};

const ESTADOS_VALIDOS = ['BUENO', 'REGULAR', 'MALO'];
const TIPOS_DANO_VALIDOS = ['RASPONES', 'GOLPES', 'ABOLLADURAS', 'PERFORACIONES', 'OTROS'];
const ESTADOS_GENERALES = ['SIN_DANOS', 'CON_DANOS', 'NO_APLICA'];

// ¿Ese componente pertenece a esa vista? Evita que se guarde un punto
// que el formato no contempla para esa vista.
function componenteValido(vista, componente) {
  const lista = COMPONENTES_POR_VISTA[vista];
  return Array.isArray(lista) && lista.includes(componente);
}

module.exports = {
  VISTAS,
  VISTA_LABEL,
  COMPONENTES_POR_VISTA,
  ESTADOS_VALIDOS,
  TIPOS_DANO_VALIDOS,
  ESTADOS_GENERALES,
  componenteValido,
};
