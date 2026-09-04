import { useEffect } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { AttributionPanel } from './components/AttributionPanel';
import { ChannelsView } from './components/ChannelsView';
import { ChatThread } from './components/ChatThread';
import { ConnectNumberModal } from './components/ConnectNumberModal';
import { DialogList } from './components/DialogList';
import { FilterChips } from './components/FilterChips';
import { LeadsView } from './components/LeadsView';
import { SettingsView } from './components/SettingsView';
import { SideNav } from './components/SideNav';
import { TopBar } from './components/TopBar';
import { simulateIncoming, useAppState } from './lib/store';

export default function App() {
  const s = useAppState();
  const selected = s.conversations.find((c) => c.id === s.selectedId);

  useEffect(() => {
    if (!s.simulatorOn) return;
    const t = setInterval(() => simulateIncoming(), 25000);
    return () => clearInterval(t);
  }, [s.simulatorOn]);

  return (
    <div className="console">
      <TopBar />
      <div className="console-body">
        <SideNav />
        {s.view === 'inbox' && (
          <>
            <aside className="sidebar">
              <FilterChips />
              <DialogList />
            </aside>
            <main className="main">
              <ChatThread />
            </main>
            {selected && <AttributionPanel />}
          </>
        )}
        {s.view === 'channels' && <ChannelsView />}
        {s.view === 'leads' && <LeadsView />}
        {s.view === 'analytics' && <AnalyticsView />}
        {s.view === 'settings' && <SettingsView />}
      </div>
      <ConnectNumberModal />
    </div>
  );
}
