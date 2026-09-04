import { useEffect } from 'react';
import { AttributionPanel } from './components/AttributionPanel';
import { ChatThread } from './components/ChatThread';
import { ConnectNumberModal } from './components/ConnectNumberModal';
import { DialogList } from './components/DialogList';
import { FilterChips } from './components/FilterChips';
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
        <aside className="sidebar">
          <FilterChips />
          <DialogList />
        </aside>
        <main className={`main ${selected ? '' : 'wide'}`}>
          <ChatThread />
        </main>
        {selected && (
          <AttributionPanel />
        )}
      </div>
      <ConnectNumberModal />
    </div>
  );
}
