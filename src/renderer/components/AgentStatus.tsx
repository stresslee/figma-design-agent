import React, { useState, useEffect } from 'react';
import type { AgentState } from '../../shared/types';

interface Props {
  state: AgentState | null;
  onCancel: () => void;
  taskTiming?: { startedAt: number | null; endedAt: number | null };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}분 ${sec}초`;
  return `${sec}초`;
}

export function AgentStatus({ state, onCancel, taskTiming }: Props) {
  const statusColor = getStatusColor(state?.status);
  const [elapsed, setElapsed] = useState(0);

  // Live elapsed timer while running
  useEffect(() => {
    if (!taskTiming?.startedAt || taskTiming.endedAt) {
      if (taskTiming?.startedAt && taskTiming.endedAt) {
        setElapsed(taskTiming.endedAt - taskTiming.startedAt);
      }
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Date.now() - taskTiming.startedAt!);
    }, 1000);
    return () => clearInterval(interval);
  }, [taskTiming?.startedAt, taskTiming?.endedAt]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Agent</span>
        <span style={{ ...styles.statusDot, background: statusColor }} />
      </div>

      {state ? (
        <div style={styles.content}>
          {/* Status */}
          <div style={styles.row}>
            <span style={styles.label}>Status</span>
            <span style={{ ...styles.value, color: statusColor }}>
              {formatStatus(state.status)}
            </span>
          </div>

          {/* Current action */}
          {state.currentAction && (
            <div style={styles.row}>
              <span style={styles.label}>Action</span>
              <span style={styles.value}>{state.currentAction}</span>
            </div>
          )}

          {/* Progress */}
          {state.status === 'running' || state.status === 'streaming' ? (
            <div style={styles.progressContainer}>
              <div style={styles.progressBar}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${state.progress || 0}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {/* Streaming text preview */}
          {state.streamingText && (
            <div style={styles.streamingPreview}>
              <span style={styles.label}>Streaming</span>
              <div style={styles.streamingText}>
                {state.streamingText.slice(-200)}
              </div>
            </div>
          )}

          {/* Cancel button */}
          {(state.status === 'running' || state.status === 'streaming') && (
            <button style={styles.cancelButton} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div style={styles.idle}>
          <span style={styles.idleText}>No agent running</span>
        </div>
      )}

      {/* Task timing (bottom of sidebar) */}
      {taskTiming?.startedAt && (
        <div style={styles.timingSection}>
          <div style={styles.timingHeader}>Timing</div>
          <div style={styles.timingRow}>
            <span style={styles.timingLabel}>시작</span>
            <span style={styles.timingValue}>{formatTime(taskTiming.startedAt)}</span>
          </div>
          {taskTiming.endedAt ? (
            <div style={styles.timingRow}>
              <span style={styles.timingLabel}>종료</span>
              <span style={styles.timingValue}>{formatTime(taskTiming.endedAt)}</span>
            </div>
          ) : null}
          <div style={styles.timingRow}>
            <span style={styles.timingLabel}>소요</span>
            <span style={{
              ...styles.timingValue,
              color: taskTiming.endedAt ? '#22c55e' : '#f59e0b',
              fontWeight: 600,
            }}>
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusColor(status?: string): string {
  switch (status) {
    case 'running': return '#f59e0b';
    case 'streaming': return '#3b82f6';
    case 'done': return '#22c55e';
    case 'error': return '#ef4444';
    default: return '#555';
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'streaming': return 'Streaming';
    case 'done': return 'Complete';
    case 'error': return 'Error';
    case 'idle': return 'Idle';
    default: return status;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    height: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#888',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: '12px',
    color: '#666',
  },
  value: {
    fontSize: '12px',
    color: '#ccc',
    textAlign: 'right' as const,
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  progressContainer: {
    marginTop: '4px',
  },
  progressBar: {
    height: '3px',
    background: '#222',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#3b82f6',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  streamingPreview: {
    marginTop: '4px',
  },
  streamingText: {
    marginTop: '4px',
    fontSize: '11px',
    color: '#888',
    fontFamily: 'monospace',
    lineHeight: 1.4,
    maxHeight: '100px',
    overflow: 'auto',
    padding: '8px',
    background: '#111',
    borderRadius: '6px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  cancelButton: {
    marginTop: '8px',
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #333',
    background: 'transparent',
    color: '#ef4444',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  idle: {
    padding: '20px 0',
    textAlign: 'center' as const,
  },
  idleText: {
    fontSize: '12px',
    color: '#555',
  },
  timingSection: {
    marginTop: 'auto',
    paddingTop: '12px',
    borderTop: '1px solid #222',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  timingHeader: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#666',
    marginBottom: '2px',
  },
  timingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timingLabel: {
    fontSize: '12px',
    color: '#666',
  },
  timingValue: {
    fontSize: '12px',
    color: '#ccc',
    fontFamily: 'monospace',
  },
};
