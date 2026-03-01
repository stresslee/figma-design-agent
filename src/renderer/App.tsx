import React from 'react';
import { ChatPanel } from './components/ChatPanel';
import { AgentStatus } from './components/AgentStatus';
import { FigmaConnection } from './components/FigmaConnection';
import { useAgent } from './hooks/useAgent';

export default function App() {
  const {
    messages,
    agentState,
    figmaStatus,
    sendMessage,
    cancelAgent,
    joinChannel,
  } = useAgent();

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Figma Design Agent</h1>
        </div>
        <div style={styles.headerRight}>
          <FigmaConnection
            status={figmaStatus}
            onJoinChannel={joinChannel}
          />
        </div>
      </header>

      {/* Main content */}
      <div style={styles.main}>
        {/* Chat panel (center) */}
        <div style={styles.chatArea}>
          <ChatPanel
            messages={messages}
            onSendMessage={sendMessage}
            isLoading={agentState?.status === 'streaming' || agentState?.status === 'running'}
          />
        </div>

        {/* Agent status sidebar */}
        <div style={styles.sidebar}>
          <AgentStatus
            state={agentState}
            onCancel={cancelAgent}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f0f0f',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    paddingTop: '36px', // Account for title bar drag region
    borderBottom: '1px solid #222',
    background: '#151515',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e0e0e0',
    letterSpacing: '-0.02em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  chatArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebar: {
    width: '280px',
    borderLeft: '1px solid #222',
    background: '#151515',
    overflow: 'auto',
    flexShrink: 0,
  },
};
