import { cancelPairing, startPairing, useAppState } from '../lib/store';
import type { Pairing } from '../lib/store';

const QR_N = 25;

function qrCells(seed: string): boolean[] {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const cells: boolean[] = [];
  let x = h >>> 0 || 123456789;
  for (let i = 0; i < QR_N * QR_N; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    cells.push((x & 1) === 1);
  }
  const finder = (r0: number, c0: number) => {
    for (let dr = 0; dr < 7; dr++)
      for (let dc = 0; dc < 7; dc++) {
        const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        cells[(r0 + dr) * QR_N + (c0 + dc)] = edge || core;
      }
  };
  finder(0, 0);
  finder(0, QR_N - 7);
  finder(QR_N - 7, 0);
  return cells;
}

function FakeQr({ pairing }: { pairing: Pairing }) {
  const cells = qrCells(pairing.qrSeed);
  return (
    <div
      className={`qr-grid ${pairing.status === 'waiting' ? '' : 'dim'}`}
      style={{ gridTemplateColumns: `repeat(${QR_N}, 1fr)` }}
    >
      {cells.map((on, i) => (
        <span key={i} className={on ? 'qr-on' : ''} />
      ))}
    </div>
  );
}

const STATUS_TEXT: Record<Pairing['status'], string> = {
  waiting: 'Відкрийте WhatsApp / Telegram → Пристрої → скануйте код',
  scanned: 'Відскановано. Синхронізація повідомлень…',
  syncing: 'Синхронізація…',
  connected: 'Підключено ✓',
};

export function ConnectNumberModal() {
  const s = useAppState();
  const p = s.pairing;
  if (!p) return null;
  const connected = p.status === 'connected';

  return (
    <div className="modal-backdrop" onClick={cancelPairing}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {p.kind !== 'wa' && p.kind !== 'tg' ? null : (
          <>
            <h3>{p.kind === 'wa' ? 'Підключення WhatsApp' : 'Підключення Telegram'}</h3>
            <div className="qr-wrap">
              <FakeQr pairing={p} />
            </div>
            <p className={`qr-status ${connected ? 'ok' : ''}`}>{STATUS_TEXT[p.status]}</p>
            <div className="modal-actions">
              {!connected ? (
                <>
                  <button className="btn outline" onClick={() => startPairing(p.kind)}>
                    Оновити код
                  </button>
                  <button className="btn ghost" onClick={cancelPairing}>
                    Скасувати
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={cancelPairing}>
                  Готово
                </button>
              )}
            </div>
            <p className="qr-note">
              У продакшені QR генерує воркер сесій (Evolution API / gramjs). Тут — симуляція.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
