import { useEffect } from 'react';
import { AdminView } from './components/AdminView';
import { AnalyticsView } from './components/AnalyticsView';
import { AuthGate, useSession } from './components/AuthGate';
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
import { isSuperAdmin, pullRemoteState, signInUser, simulateIncoming, syncChannelStatuses, useAppState } from './lib/store';
import { useConnections } from './lib/connections';
import { workerApi } from './lib/worker';

export default function App() {
  const { session, loading } = useSession();
  const s = useAppState();
  const conn = useConnections();
  const email = session?.user?.email ?? null;
  const selected = s.conversations.find((c) => c.id === s.selectedId);

  useEffect(() => {
    if (email) {
      signInUser(email);
      void pullRemoteState();
    }
  }, [email]);

  useEffect(() => {
    if (!s.simulatorOn || !session || conn.mode !== 'demo') return;
    const t = setInterval(() => simulateIncoming(), 25000);
    return () => clearInterval(t);
  }, [s.simulatorOn, session, conn.mode]);

  useEffect(() => {
    if (conn.mode !== 'production' || conn.workerStatus.state !== 'ok') return;
    let stop = false;
    const sync = async () => {
      try {
        const instances = await workerApi.fetchInstances();
        if (!stop) syncChannelStatuses(instances);
      } catch {
        // воркер недоступен — статусы не трогаем
      }
    };
    void sync();
    const t = setInterval(sync, 60000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [conn.mode, conn.workerStatus.state]);

  if (loading) {
    return <div className="auth-gate" />;
  }
  if (!session || !email) {
    return <AuthGate />;
  }

  const view = s.view === 'admin' && !isSuperAdmin(s) ? 'inbox' : s.view;

  return (
    <div className="console">
      <TopBar userEmail={email} />
      <div className="console-body">
        <SideNav />
        {view === 'inbox' && (
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
        {view === 'channels' && <ChannelsView />}
        {view === 'admin' && <AdminView />}
        {view === 'leads' && <LeadsView />}
        {view === 'analytics' && <AnalyticsView />}
        {view === 'settings' && <SettingsView />}
      </div>
      <ConnectNumberModal />
    </div>
  );
}
