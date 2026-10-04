import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Reserva, SLOTS, buscarReserva, cancelarReserva, modificarReserva, ocupadas } from '../lib/api';

const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const ahoraHHMM = () => new Date().toTimeString().slice(0, 5);

export default function MisReservas() {
  const [params] = useSearchParams();
  const [id, setId] = useState('');
  const [cod, setCod] = useState((params.get('codigo') || '').toUpperCase().slice(0, 6));
  const [r, setR] = useState<Reserva | null>(null);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ fecha: string; hora: string } | null>(null);
  const [occ, setOcc] = useState<{ hora: string; consola: string }[]>([]);

  useEffect(() => {
    if (!edit || !r) return;
    ocupadas(edit.fecha).then((x) => x.ok && setOcc(x.ocupadas));
  }, [edit?.fecha, r?.codigo]);

  const aviso = (texto: string, bien = false) => { setMsg(texto); setOk(bien); };

  async function buscar() {
    aviso(''); setR(null); setEdit(null); setBusy(true);
    const x = await buscarReserva(id, cod);
    setBusy(false);
    if (x.ok) setR(x.reserva); else aviso(x.error);
  }

  async function cancelar() {
    if (!confirm('¿Cancelar esta reserva?')) return;
    setBusy(true);
    const x = await cancelarReserva(id, cod);
    setBusy(false);
    if (x.ok) { setR(null); setEdit(null); aviso('Reserva cancelada. Te hemos enviado la confirmación por correo.', true); }
    else aviso(x.error);
  }

  async function guardar() {
    if (!edit?.hora) return aviso('Elige una hora.');
    setBusy(true);
    const x = await modificarReserva(id, cod, edit);
    setBusy(false);
    if (x.ok) { setR(x.reserva); setEdit(null); aviso('Reserva modificada. Te hemos enviado los nuevos datos por correo.', true); }
    else aviso(x.error);
  }

  const libre = (h: string) =>
    !!r && !!edit &&
    !occ.some((o) => o.hora === h && o.consola === r.consola && !(edit.fecha === r.fecha && h === r.hora));
  const pasada = (h: string) => !!edit && edit.fecha === hoyISO() && h <= ahoraHHMM();

  return (
    <section className="max-w-md mx-auto space-y-4">
      <h1 className="font-title text-2xl text-green-400">Mis reservas</h1>

      <label className="block">
        Correo de la reserva
        <input
          className="input mt-1"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="o tu teléfono, si reservaste sin correo"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label className="block">
        Código de reserva
        <input className="input mt-1 uppercase" maxLength={6} value={cod} onChange={(e) => setCod(e.target.value.toUpperCase())} />
      </label>
      <button className="btn-primary w-full" onClick={buscar} disabled={busy}>{busy && !r ? 'Buscando…' : 'Buscar'}</button>

      {msg && <p role="alert" className={ok ? 'text-green-400' : 'text-amber-400'}>{msg}</p>}

      {r && !edit && (
        <div className="border border-zinc-700 rounded-lg p-4 space-y-1">
          <p className="font-semibold">{r.consola} · {r.jugadores} jugador(es)</p>
          <p>{r.fecha} a las {r.hora}</p>
          <p className="text-sm text-zinc-400">Estado: {r.estado}</p>
          {r.estado === 'Confirmada' && r.puedeCambiar && (
            <div className="flex flex-wrap gap-2 pt-3">
              <button className="btn-ghost" onClick={() => setEdit({ fecha: r.fecha, hora: r.hora })}>Cambiar fecha u hora</button>
              <button className="btn-ghost" onClick={cancelar} disabled={busy}>Cancelar reserva</button>
            </div>
          )}
          {r.estado === 'Confirmada' && !r.puedeCambiar && (
            <p className="text-sm text-amber-400 pt-2">
              Ya no se puede cambiar online. Escríbenos por{' '}
              <a className="underline" href="https://wa.me/34668581523" target="_blank" rel="noopener noreferrer">WhatsApp</a>.
            </p>
          )}
        </div>
      )}

      {r && edit && (
        <div className="border border-zinc-700 rounded-lg p-4 space-y-4">
          <label className="block">
            Nueva fecha
            <input
              type="date"
              className="input mt-1"
              min={hoyISO()}
              value={edit.fecha}
              onChange={(e) => e.target.value && setEdit({ fecha: e.target.value, hora: '' })}
            />
          </label>
          <fieldset>
            <legend className="mb-1">Nueva hora</legend>
            <div className="grid grid-cols-3 gap-2">
              {SLOTS.map((h) => (
                <button
                  type="button"
                  key={h}
                  disabled={!libre(h) || pasada(h)}
                  aria-pressed={edit.hora === h}
                  onClick={() => setEdit({ ...edit, hora: h })}
                  className={`btn border ${edit.hora === h ? 'bg-green-500 text-black border-green-500' : 'border-zinc-600'} disabled:opacity-30 disabled:line-through`}
                >
                  {h}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
            <button className="btn-ghost" onClick={() => setEdit(null)}>Volver</button>
          </div>
        </div>
      )}
    </section>
  );
}
