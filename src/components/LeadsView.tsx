import { ATTRIBUTION_LABEL } from '../lib/attribution';
import { channelById, companyConversations, selectConversation, setView, useAppState } from '../lib/store';

export function LeadsView() {
  const s = useAppState();
  const leads = companyConversations(s).sort((a, b) => b.lastTs - a.lastTs);

  const open = (id: string) => {
    selectConversation(id);
    setView('inbox');
  };

  return (
    <div className="view">
      <h2>Ліди</h2>
      <p className="view-sub">
        Усі звернення з робочих каналів з UTM-атрибуцією. Натисніть на рядок, щоб відкрити діалог.
      </p>
      <table className="leads-table">
        <thead>
          <tr>
            <th>Ім'я</th>
            <th>Канал</th>
            <th>Телефон</th>
            <th>Атрибуція</th>
            <th>Джерело</th>
            <th>Кампанія</th>
            <th>GCLID</th>
            <th>Останнє повідомлення</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((c) => {
            const ch = channelById(s, c.channelId);
            return (
              <tr key={c.id} onClick={() => open(c.id)}>
                <td className="td-name">{c.contactName}</td>
                <td>{ch?.displayName ?? '—'}</td>
                <td className="mono">{c.phone ?? '—'}</td>
                <td>
                  {c.attribution && (
                    <span className={`attr-badge ${c.attribution.slice(0, 2)}`}>
                      {ATTRIBUTION_LABEL[c.attribution]}
                    </span>
                  )}
                </td>
                <td className="mono">{c.utmSource ?? '—'}</td>
                <td className="mono">{c.utmCampaign ?? '—'}</td>
                <td className="mono">{c.gclid ? `${c.gclid.slice(0, 10)}…` : '—'}</td>
                <td className="mono">
                  {new Date(c.lastTs).toLocaleString('uk-UA', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
