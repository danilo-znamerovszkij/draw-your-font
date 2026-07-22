'use strict';
const MINIMAL = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ...`.,;:!?'"-()@#&+/$`,
];
const SPANISH = [...MINIMAL, ...'ÑñÁÉÍÓÚáéíóúü¿¡'];

module.exports = { CHARSETS: { minimal: MINIMAL, spanish: SPANISH } };
