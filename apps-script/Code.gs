/**
 * La Base 420 – Backend de reservas v2 (Google Apps Script)
 * Contrato (POST, text/plain con JSON {accion, ...}):
 *   crear | listar | misReservas | modificar | cancelar
 *   admin_listar | admin_cancelar | admin_bloquear | admin_desbloquear
 *
 * Contraseña admin: Configuración del proyecto → Propiedades del script → ADMIN_PASSWORD
 * Despliegue: Ejecutar como "Yo" · Acceso "Cualquier usuario"
 */

const CFG = {
  SHEET_ID: '1opV7zocVy5VYEGMLooxKLM9ey2rHKgPiaJWB_nxYFXk',
  HOJA_RESERVAS: 'Reservas',
  HOJA_BLOQUEOS: 'Bloqueos',
  TZ: 'Europe/Madrid',
  NEGOCIO: 'La Base 420',
  OWNER_EMAIL: 'administracion@labase420.com',   // avisos + reply-to
  AVISAR_DUENO: true,
  URL_WEB: 'https://papelegruba-ppb.github.io/base-420-gaming/',  // con "/" final; cámbiala si usas labase420.com
  WHATSAPP: '34668581523',
  DIRECCION: 'Carrer Nadal Meroles 12, 25008 Lleida',
  PRECIO_HORA: 10,
  CONSOLAS: ['PS5'],
  SLOTS: ['16:30', '17:30', '18:30', '19:30', '20:30'],
  MAX_JUGADORES: 2,
  HORAS_ANTELACION: 2,       // mínimo para cambiar/cancelar online (0 = sin límite)
};

// Nombres de columna aceptados (se detectan por cabecera; las que falten se añaden solas)
const CAMPOS_RES = {
  fecha: ['fecha'], hora: ['hora'], consola: ['consola'], jugadores: ['jugadores'],
  nombre: ['nombre'], telefono: ['telefono', 'tel'], email: ['email', 'correo', 'mail'],
  notas: ['notas'], estado: ['estado'], codigo: ['codigo'],
  creada: ['creada', 'timestamp', 'marca temporal'], actualizada: ['actualizada'],
};
const CAMPOS_BLQ = { fecha: ['fecha'], hora: ['hora'], consola: ['consola'], motivo: ['motivo'] };

let SS_ = null;

/* ═════════════ Endpoints ═════════════ */

function doGet() { return json_({ ok: true, servicio: CFG.NEGOCIO }); }

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    switch (d.accion) {
      case 'crear':             return json_(crear_(d));
      case 'listar':            return json_(listar_(d));
      case 'misReservas':       return json_(mis_(d));
      case 'modificar':         return json_(modificar_(d));
      case 'cancelar':          return json_(cancelar_(d));
      case 'admin_listar':      return json_(adminListar_(d));
      case 'admin_cancelar':    return json_(adminCancelar_(d));
      case 'admin_bloquear':    return json_(adminBloquear_(d));
      case 'admin_desbloquear': return json_(adminDesbloquear_(d));
      default: throw new Error('Acción no válida');
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: err.message });
  }
}

/* ═════════════ Cliente ═════════════ */

function crear_(d) {
  limite_('c_' + normEmail_(d.email), 5, 3600);
  return conLock_(() => {
    const v = validar_(d, null, false);
    const t = tabla_(CFG.HOJA_RESERVAS);
    const ahora = ahora_();
    const o = Object.assign({}, v, { codigo: nuevoCodigo_(t), estado: 'Confirmada', creada: ahora, actualizada: ahora });
    escribirFila_(t, t.sh.getLastRow() + 1, o);
    const enviado = correo_(o, 'Reserva confirmada');
    avisoDueno_(o, 'Nueva reserva');
    return { ok: true, codigo: o.codigo, emailEnviado: enviado };
  });
}

function listar_(d) {
  const fecha = String(d.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no válida');
  const out = [];
  leer_(tabla_(CFG.HOJA_RESERVAS)).forEach(r => {
    if (esConf_(r.o) && r.o.fecha === fecha) out.push({ hora: r.o.hora, consola: r.o.consola });
  });
  leer_(tabla_(CFG.HOJA_BLOQUEOS)).forEach(b => {
    if (b.o.fecha !== fecha) return;
    (b.o.consola === 'Todas' ? CFG.CONSOLAS : [b.o.consola]).forEach(c => out.push({ hora: b.o.hora, consola: c }));
  });
  return { ok: true, ocupadas: out };
}

function mis_(d) {
  const b = buscar_(d.identificador || d.telefono, d.codigo);
  return { ok: true, reserva: pub_(b.o) };
}

function modificar_(d) {
  return conLock_(() => {
    const b = buscar_(d.identificador || d.telefono, d.codigo);
    comprobarEditable_(b.o);
    const v = validar_({
      nombre: b.o.nombre, email: b.o.email, telefono: b.o.telefono, notas: b.o.notas,
      consola: d.consola || b.o.consola, jugadores: d.jugadores || b.o.jugadores,
      fecha: d.fecha || b.o.fecha, hora: d.hora || b.o.hora,
    }, b.o.codigo, true);
    Object.assign(b.o, v, { actualizada: ahora_() });
    escribirFila_(b.t, b.fila, b.o);
    correo_(b.o, 'Reserva modificada');
    avisoDueno_(b.o, 'Reserva modificada');
    return { ok: true, reserva: pub_(b.o) };
  });
}

function cancelar_(d) {
  return conLock_(() => {
    const b = buscar_(d.identificador || d.telefono, d.codigo);
    comprobarEditable_(b.o);
    b.o.estado = 'Cancelada';
    b.o.actualizada = ahora_();
    escribirFila_(b.t, b.fila, b.o);
    correo_(b.o, 'Reserva cancelada');
    avisoDueno_(b.o, 'Reserva cancelada');
    return { ok: true };
  });
}

/* ═════════════ Admin ═════════════ */

function adminListar_(d) {
  checkAdmin_(d.password);
  const fecha = String(d.fecha || '');
  const reservas = leer_(tabla_(CFG.HOJA_RESERVAS))
    .filter(r => r.o.fecha === fecha)
    .map(r => pub_(r.o))
    .sort((a, b) => a.hora.localeCompare(b.hora));
  const bloqueos = leer_(tabla_(CFG.HOJA_BLOQUEOS))
    .filter(b => b.o.fecha === fecha)
    .map(b => ({ fecha: b.o.fecha, hora: b.o.hora, consola: b.o.consola, motivo: b.o.motivo }));
  return { ok: true, reservas, bloqueos };
}

function adminCancelar_(d) {
  checkAdmin_(d.password);
  return conLock_(() => {
    const t = tabla_(CFG.HOJA_RESERVAS);
    const cod = String(d.codigo || '').trim().toUpperCase();
    const r = leer_(t).find(x => x.o.codigo.toUpperCase() === cod);
    if (!r) throw new Error('Reserva no encontrada');
    r.o.estado = 'Cancelada';
    r.o.actualizada = ahora_();
    escribirFila_(t, r.fila, r.o);
    correo_(r.o, 'Reserva cancelada por el local');
    return { ok: true };
  });
}

function adminBloquear_(d) {
  checkAdmin_(d.password);
  return conLock_(() => {
    const fecha = String(d.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no válida');
    if (CFG.SLOTS.indexOf(d.hora) < 0) throw new Error('Hora no válida');
    if (['Todas'].concat(CFG.CONSOLAS).indexOf(d.consola) < 0) throw new Error('Consola no válida');
    const t = tabla_(CFG.HOJA_BLOQUEOS);
    escribirFila_(t, t.sh.getLastRow() + 1,
      { fecha, hora: d.hora, consola: d.consola, motivo: String(d.motivo || '').slice(0, 100) });
    return { ok: true };
  });
}

function adminDesbloquear_(d) {
  checkAdmin_(d.password);
  return conLock_(() => {
    const t = tabla_(CFG.HOJA_BLOQUEOS);
    const b = leer_(t).find(x => x.o.fecha === d.fecha && x.o.hora === d.hora && x.o.consola === d.consola);
    if (!b) throw new Error('Bloqueo no encontrado');
    t.sh.deleteRow(b.fila);
    return { ok: true };
  });
}

function checkAdmin_(pw) {
  const c = CacheService.getScriptCache();
  const fallos = Number(c.get('adm_fail') || 0);
  if (fallos >= 10) throw new Error('Demasiados intentos. Espera unos minutos.');
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('Falta configurar ADMIN_PASSWORD en las propiedades del script');
  if (String(pw) !== real) { c.put('adm_fail', String(fallos + 1), 900); throw new Error('Contraseña incorrecta'); }
}

/* ═════════════ Validación ═════════════ */

function validar_(d, excluir, emailOpcional) {
  const email = normEmail_(d.email);
  if (!(emailOpcional && !email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('El correo es obligatorio y debe ser válido.');
  }
  const nombre = String(d.nombre || '').trim();
  if (nombre.length < 2) throw new Error('Escribe tu nombre.');
  const telefono = normTel_(d.telefono);
  if (!/^[6-9]\d{8}$/.test(telefono)) throw new Error('Teléfono no válido (9 dígitos).');
  const consola = String(d.consola || '');
  if (CFG.CONSOLAS.indexOf(consola) < 0) throw new Error('Consola no válida.');
  const fecha = String(d.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no válida.');
  const hora = String(d.hora || '');
  if (CFG.SLOTS.indexOf(hora) < 0) throw new Error('Hora no válida.');
  const jugadores = Number(d.jugadores || 1);
  if (!Number.isInteger(jugadores) || jugadores < 1 || jugadores > CFG.MAX_JUGADORES) {
    throw new Error('Máximo ' + CFG.MAX_JUGADORES + ' jugadores.');
  }
  if (inicioDate_(fecha, hora) <= new Date()) throw new Error('Esa hora ya ha pasado.');
  if (ocupadoEn_(fecha, hora, consola, excluir)) throw new Error('Ese horario acaba de ocuparse. Elige otro.');
  return { nombre, email, telefono, consola, fecha, hora, jugadores, notas: String(d.notas || '').trim().slice(0, 300) };
}

function ocupadoEn_(fecha, hora, consola, excluir) {
  const enReservas = leer_(tabla_(CFG.HOJA_RESERVAS)).some(r =>
    esConf_(r.o) && r.o.codigo !== excluir && r.o.fecha === fecha && r.o.hora === hora && r.o.consola === consola);
  if (enReservas) return true;
  return leer_(tabla_(CFG.HOJA_BLOQUEOS)).some(b =>
    b.o.fecha === fecha && b.o.hora === hora && (b.o.consola === 'Todas' || b.o.consola === consola));
}

function puedeCambiar_(o) {
  return esConf_(o) && inicioDate_(o.fecha, o.hora) - new Date() >= CFG.HORAS_ANTELACION * 3600000;
}

function comprobarEditable_(o) {
  if (!esConf_(o)) throw new Error('Esta reserva ya está cancelada.');
  if (!puedeCambiar_(o)) {
    throw new Error('Solo se puede cambiar o cancelar con ' + CFG.HORAS_ANTELACION + ' h de antelación. Escríbenos por WhatsApp.');
  }
}

/* Búsqueda: (correo O teléfono) + código. Mantiene accesibles las reservas antiguas sin correo. */
function buscar_(ident, codigo) {
  const cod = String(codigo || '').trim().toUpperCase();
  const id = normId_(ident);
  if (!cod || !id) throw new Error('Indica tu correo (o teléfono) y el código.');
  limite_('f_' + cod, 10, 3600);
  const t = tabla_(CFG.HOJA_RESERVAS);
  const r = leer_(t).find(x => x.o.codigo.toUpperCase() === cod &&
    (id.indexOf('@') >= 0 ? normEmail_(x.o.email) === id : normTel_(x.o.telefono) === id));
  if (!r) throw new Error('No encontramos ninguna reserva con esos datos.');
  return { t, o: r.o, fila: r.fila };
}

/* ═════════════ Hojas (detección por cabecera) ═════════════ */

function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(CFG.SHEET_ID)); }

function tabla_(nombre) {
  const campos = nombre === CFG.HOJA_BLOQUEOS ? CAMPOS_BLQ : CAMPOS_RES;
  const sh = ss_().getSheetByName(nombre) || ss_().insertSheet(nombre);
  let ncols = sh.getLastColumn();
  const cab = ncols ? sh.getRange(1, 1, 1, ncols).getValues()[0].map(norm_) : [];
  const idx = {};
  Object.keys(campos).forEach(k => {
    let i = cab.findIndex(h => campos[k].indexOf(h) >= 0);
    if (i < 0) { ncols++; sh.getRange(1, ncols).setValue(k); cab.push(k); i = ncols - 1; }
    idx[k] = i;
  });
  return { sh, idx, ncols };
}

function leer_(t) {
  const n = t.sh.getLastRow();
  if (n < 2) return [];
  const vals = t.sh.getRange(2, 1, n - 1, t.ncols).getValues();
  const out = [];
  vals.forEach((row, i) => {
    const o = {};
    Object.keys(t.idx).forEach(k => o[k] = row[t.idx[k]]);
    o.fecha = txt_(o.fecha, 'yyyy-MM-dd');
    o.hora = txt_(o.hora, 'HH:mm');
    if (!o.fecha) return;
    Object.keys(o).forEach(k => { if (k !== 'fecha' && k !== 'hora') o[k] = txt_(o[k], 'yyyy-MM-dd HH:mm:ss'); });
    if ('jugadores' in o) o.jugadores = Number(o.jugadores) || 1;
    out.push({ o, fila: i + 2 });
  });
  return out;
}

function escribirFila_(t, fila, o) {
  const rng = t.sh.getRange(fila, 1, 1, t.ncols);
  const row = rng.getValues()[0];
  Object.keys(t.idx).forEach(k => { if (o[k] !== undefined) row[t.idx[k]] = o[k]; });
  rng.setNumberFormat('@');   // texto: evita que Sheets convierta fechas/horas/teléfonos
  rng.setValues([row]);
}

/* ═════════════ Correo ═════════════ */

function correo_(o, asunto) {
  if (!o.email) return false;
  try {
    const cancelada = norm_(o.estado) === 'cancelada';
    const link = CFG.URL_WEB + 'mis-reservas?codigo=' + encodeURIComponent(o.codigo);
    const wa = 'https://wa.me/' + CFG.WHATSAPP;
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:10px">' +
      '<h2 style="margin-top:0">' + esc_(CFG.NEGOCIO) + '</h2>' +
      '<p>Hola ' + esc_(o.nombre) + ', ' +
        (cancelada ? 'tu reserva está <b>cancelada</b>.' : 'estos son los datos de tu reserva:') + '</p>' +
      '<p style="font-size:28px;letter-spacing:4px;background:#f3f3f3;padding:12px;text-align:center;border-radius:8px"><b>' + esc_(o.codigo) + '</b></p>' +
      '<ul><li><b>Consola:</b> ' + esc_(o.consola) + '</li>' +
      '<li><b>Fecha:</b> ' + o.fecha + '</li>' +
      '<li><b>Hora:</b> ' + o.hora + ' (1 hora)</li>' +
      '<li><b>Jugadores:</b> ' + o.jugadores + '</li>' +
      (cancelada ? '' : '<li><b>Precio:</b> ' + CFG.PRECIO_HORA + ' €</li>') +
      '<li><b>Dónde:</b> ' + esc_(CFG.DIRECCION) + '</li></ul>' +
      (cancelada ? '' :
        '<p>Para verla, cambiarla o cancelarla (hasta ' + CFG.HORAS_ANTELACION + ' h antes) necesitas este código y tu correo:</p>' +
        '<p><a href="' + link + '">Gestionar mi reserva</a></p>') +
      '<p style="color:#666;font-size:13px">¿Dudas? <a href="' + wa + '">WhatsApp</a></p></div>';
    const texto = CFG.NEGOCIO + ' · ' + asunto + '\nCódigo: ' + o.codigo + '\n' + o.consola + ' · ' + o.fecha + ' · ' + o.hora +
      '\nGestionar: ' + link;
    MailApp.sendEmail({
      to: o.email, subject: CFG.NEGOCIO + ' · ' + asunto + ' · ' + o.codigo,
      htmlBody: html, body: texto, name: CFG.NEGOCIO, replyTo: CFG.OWNER_EMAIL,
    });
    return true;
  } catch (e) { console.error('Correo falló: ' + e); return false; }
}

function avisoDueno_(o, asunto) {
  if (!CFG.AVISAR_DUENO) return;
  try {
    MailApp.sendEmail(CFG.OWNER_EMAIL, asunto + ' · ' + o.codigo,
      [o.nombre, o.email, o.telefono, o.consola, o.fecha + ' ' + o.hora, o.jugadores + ' jug.', o.notas].join('\n'));
  } catch (e) { console.error(e); }
}

/* ═════════════ Utilidades ═════════════ */

function nuevoCodigo_(t) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const usados = new Set(leer_(t).map(r => r.o.codigo.toUpperCase()));
  let c;
  do { c = ''; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; } while (usados.has(c));
  return c;
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function limite_(clave, max, seg) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(clave) || 0);
  if (n >= max) throw new Error('Demasiados intentos. Inténtalo más tarde.');
  c.put(clave, String(n + 1), seg);
}

const norm_ = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const esConf_ = o => norm_(o.estado) === 'confirmada';
const normEmail_ = v => String(v == null ? '' : v).trim().toLowerCase();
const normTel_ = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^34(?=\d{9}$)/, '');
const normId_ = v => String(v || '').indexOf('@') >= 0 ? normEmail_(v) : normTel_(v);
const inicioDate_ = (f, h) => Utilities.parseDate(f + ' ' + h, CFG.TZ, 'yyyy-MM-dd HH:mm');
const ahora_ = () => Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
const txt_ = (v, fmt) => v instanceof Date ? Utilities.formatDate(v, CFG.TZ, fmt) : String(v == null ? '' : v).trim();
const esc_ = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);

const pub_ = o => ({
  fecha: o.fecha, hora: o.hora, consola: o.consola, jugadores: o.jugadores, nombre: o.nombre,
  telefono: o.telefono, email: o.email, notas: o.notas, estado: o.estado, codigo: o.codigo,
  puedeCambiar: puedeCambiar_(o),
});

/** Ejecuta UNA vez desde el editor: crea/ajusta pestañas, columnas y concede permisos (Sheets + Gmail). */
function autorizar() {
  tabla_(CFG.HOJA_RESERVAS);
  tabla_(CFG.HOJA_BLOQUEOS);
  console.log('Cuota de correos hoy: ' + MailApp.getRemainingDailyQuota());
}
