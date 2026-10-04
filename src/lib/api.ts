// Pon la URL del Apps Script en .env: VITE_API_URL=https://script.google.com/macros/s/XXXX/exec
const API_URL = import.meta.env.VITE_API_URL as string;

export const SLOTS = ['16:30', '17:30', '18:30', '19:30', '20:30'];
export const CONSOLAS = ['PS5'];

export interface Reserva {
  fecha: string; hora: string; consola: string; jugadores: number;
  nombre: string; telefono: string; email?: string; notas?: string;
  estado?: string; codigo?: string; puedeCambiar?: boolean;
}
export interface Bloqueo { fecha: string; hora: string; consola: string; motivo: string; }
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Solo se reintenta lo que no modifica datos: reintentar un "crear" tras un timeout podría duplicar o dar un falso "ocupado".
const REINTENTABLES = new Set(['listar', 'misReservas', 'admin_listar']);

async function call<T = object>(accion: string, data: object = {}): Promise<Res<T>> {
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS en Apps Script
    body: JSON.stringify({ accion, ...data }),
    redirect: 'follow',
  };
  const intentos = REINTENTABLES.has(accion) ? 2 : 1;

  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetchWithTimeout(API_URL, options, i === 0 ? 15000 : 20000);
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch {
        return { ok: false, error: 'Respuesta inválida del servidor. Revisa la implementación del Apps Script.' };
      }
    } catch (err: any) {
      const timeout = err?.name === 'AbortError';
      if (timeout && i < intentos - 1) continue;
      if (timeout) {
        return {
          ok: false,
          error: REINTENTABLES.has(accion)
            ? 'El servidor tarda demasiado. Espera unos segundos y vuelve a intentarlo.'
            : 'El servidor tarda demasiado. Antes de reintentar, mira tu correo por si la operación ya se hizo.',
        };
      }
      return { ok: false, error: 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.' };
    }
  }
  return { ok: false, error: 'Error inesperado.' };
}

export const normTel = (t: string) => t.replace(/\D/g, '').replace(/^34(?=\d{9}$)/, '');
export const normId = (v: string) => (v.includes('@') ? v.trim().toLowerCase() : normTel(v));
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export const crearReserva = (r: Reserva) => call<{ codigo: string; emailEnviado: boolean }>('crear', r);
export const ocupadas = (fecha: string) => call<{ ocupadas: { hora: string; consola: string }[] }>('listar', { fecha });

// identificador = correo (nuevas reservas) o teléfono (reservas antiguas sin correo)
export const buscarReserva = (identificador: string, codigo: string) =>
  call<{ reserva: Reserva }>('misReservas', { identificador: normId(identificador), codigo: codigo.trim().toUpperCase() });
export const modificarReserva = (identificador: string, codigo: string, cambios: { fecha: string; hora: string }) =>
  call<{ reserva: Reserva }>('modificar', { identificador: normId(identificador), codigo: codigo.trim().toUpperCase(), ...cambios });
export const cancelarReserva = (identificador: string, codigo: string) =>
  call('cancelar', { identificador: normId(identificador), codigo: codigo.trim().toUpperCase() });

export const adminListar = (password: string, fecha: string) =>
  call<{ reservas: Reserva[]; bloqueos: Bloqueo[] }>('admin_listar', { password, fecha });
export const adminCancelar = (password: string, codigo: string) => call('admin_cancelar', { password, codigo });
export const adminBloquear = (password: string, b: Bloqueo) => call('admin_bloquear', { password, ...b });
export const adminDesbloquear = (password: string, b: Bloqueo) => call('admin_desbloquear', { password, ...b });
