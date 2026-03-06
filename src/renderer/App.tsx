import React, { useState, useCallback, useEffect } from 'react';
import { ChatPanel, processFile } from './components/ChatPanel';
import { AgentStatus } from './components/AgentStatus';
import { FigmaConnection } from './components/FigmaConnection';
import { SettingsPanel } from './components/SettingsPanel';
import { SplashScreen } from './components/SplashScreen';
import { useAgent } from './hooks/useAgent';
import type { AttachmentData } from '../shared/types';

export default function App() {
  const {
    messages,
    agentState,
    figmaStatus,
    dsCacheStatus,
    pipelineSteps,
    taskTiming,
    sendMessage,
    cancelAgent,
    joinChannel,
  } = useAgent();

  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentData[]>([]);
  const [inputMode, setInputMode] = useState<'terminal' | 'app'>('app');

  useEffect(() => {
    const cleanup = window.electronAPI.onInputModeChange((mode: string) => {
      if (mode === 'terminal' || mode === 'app') {
        setInputMode(mode as 'terminal' | 'app');
      }
    });
    return cleanup;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide overlay when leaving the root container
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      const newAttachments: AttachmentData[] = [];
      for (const file of Array.from(e.dataTransfer.files)) {
        const attachment = await processFile(file);
        if (attachment) newAttachments.push(attachment);
      }
      if (newAttachments.length > 0) {
        setPendingAttachments(newAttachments);
      }
    }
  }, []);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  const isReady = figmaStatus.status === 'connected' && dsCacheStatus.status === 'done';

  if (!isReady) {
    return <SplashScreen figmaStatus={figmaStatus} dsCacheStatus={dsCacheStatus} />;
  }

  const isLoading = agentState?.status === 'running' || agentState?.status === 'streaming';

  return (
    <div
      style={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full-screen drag overlay */}
      {isDragOver && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragOverlayContent}>
            Drop files here (images or documents)
          </div>
        </div>
      )}

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Figma Design Agent</h1>
        </div>
        <div style={styles.headerRight}>
          <SettingsPanel figmaStatus={figmaStatus} />
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
            isLoading={isLoading}
            pipelineSteps={pipelineSteps}
            pendingAttachments={pendingAttachments}
            onClearPendingAttachments={clearPendingAttachments}
            inputMode={inputMode}
          />
        </div>

        {/* Agent status sidebar */}
        <div style={styles.sidebar}>
          <AgentStatus
            state={agentState}
            onCancel={cancelAgent}
            taskTiming={taskTiming}
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
    position: 'relative',
  },
  dragOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(37, 99, 235, 0.12)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  dragOverlayContent: {
    padding: '24px 48px',
    borderRadius: '16px',
    border: '2px dashed #2563eb',
    background: 'rgba(13, 26, 46, 0.95)',
    color: '#60a5fa',
    fontSize: '16px',
    fontWeight: 500,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    paddingTop: '36px',
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
