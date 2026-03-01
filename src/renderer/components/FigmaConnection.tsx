import React, { useState } from 'react';
import type { FigmaConnectionState } from '../../shared/types';

interface Props {
  status: FigmaConnectionState;
  onJoinChannel: (channel: string) => Promise<{ success: boolean; error?: string }>;
}

export function FigmaConnection({ status, onJoinChannel }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [channelInput, setChannelInput] = useState('');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!channelInput.trim() || joining) return;
    setJoining(true);
    try {
      const result = await onJoinChannel(channelInput.trim());
      if (result.success) {
        setShowInput(false);
        setChannelInput('');
      }
    } finally {
      setJoining(false);
    }
  };

  const statusColor =
    status.status === 'connected'
      ? '#22c55e'
      : status.status === 'connecting'
        ? '#fbbf24'
        : '#ef4444';

  const statusLabel =
    status.status === 'connected'
      ? `Figma: ${status.documentName || status.channel || 'connected'}`
      : status.status === 'connecting'
        ? 'Figma: connecting...'
        : 'Figma: disconnected';

  const isDisconnected = status.status === 'disconnected' || status.status === 'error';

  return (
    <div style={styles.container}>
      {/* Status indicator */}
      <button
        style={styles.statusButton}
        onClick={() => isDisconnected && setShowInput(!showInput)}
        title={
          status.status === 'connected'
            ? `Channel: ${status.channel}`
            : status.status === 'connecting'
              ? 'Waiting for plugin join...'
              : 'Click to manually connect'
        }
      >
        <span
          style={{
            ...styles.dot,
            background: statusColor,
            ...(status.status === 'connecting' ? styles.dotPulse : {}),
          }}
        />
        <span style={styles.statusText}>{statusLabel}</span>
      </button>

      {/* Manual channel input — only when disconnected (fallback) */}
      {showInput && isDisconnected && (
        <div style={styles.dropdown}>
          <input
            style={styles.input}
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="Channel name..."
            autoFocus
          />
          <button
            style={styles.joinButton}
            onClick={handleJoin}
            disabled={!channelInput.trim() || joining}
          >
            {joining ? '...' : 'Join'}
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative' as const,
  },
  statusButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #333',
    background: '#1e1e1e',
    color: '#ccc',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  dotPulse: {
    animation: 'none', // CSS animations not supported in inline styles
    opacity: 0.7,
  },
  statusText: {
    whiteSpace: 'nowrap' as const,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: '4px',
    display: 'flex',
    gap: '4px',
    padding: '8px',
    borderRadius: '8px',
    border: '1px solid #333',
    background: '#1e1e1e',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  input: {
    width: '160px',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #444',
    background: '#111',
    color: '#e0e0e0',
    fontSize: '12px',
    outline: 'none',
  },
  joinButton: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontSize: '12px',
    cursor: 'pointer',
  },
};
