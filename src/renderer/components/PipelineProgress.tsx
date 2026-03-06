import React, { useState, useEffect } from 'react';
import type { PipelineStepEvent, PipelineStepName } from '../../shared/types';

interface Props {
  steps: PipelineStepEvent[];
}

const STEP_LABELS: Record<PipelineStepName, { label: string; icon: string }> = {
  blueprint: { label: 'Blueprint', icon: '\u270F' },  // pencil
  resolve:   { label: 'Resolve',   icon: '\u2699' },  // gear
  build:     { label: 'Build',     icon: '\u2692' },  // hammer & pick
  image:     { label: 'Image',     icon: '\u{1F5BC}' }, // framed picture
  variables: { label: 'Variables', icon: '\u{1F3F7}' }, // label
  qa:        { label: 'QA',        icon: '\u2714' },  // check
  fix:       { label: 'Fix',       icon: '\u{1F527}' }, // wrench
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#555',
  running: '#f59e0b',
  done: '#22c55e',
  error: '#ef4444',
  skipped: '#666',
};

export function PipelineProgress({ steps }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const isRunning = steps.some((s) => s.status === 'running');
  const startTime = steps.length > 0 ? Date.now() : null;

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (steps.length === 0) return null;

  const allStepNames: PipelineStepName[] = ['blueprint', 'resolve', 'build', 'image', 'variables', 'qa', 'fix'];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Pipeline</span>
        {isRunning && (
          <span style={styles.elapsed}>{elapsed}s</span>
        )}
      </div>
      <div style={styles.steps}>
        {allStepNames.map((name, idx) => {
          const stepEvent = steps.find((s) => s.name === name);
          const status = stepEvent?.status || 'pending';
          const meta = STEP_LABELS[name];
          const color = STATUS_COLORS[status] || '#555';
          const isActive = status === 'running';

          return (
            <div
              key={name}
              style={{
                ...styles.step,
                ...(isActive ? styles.activeStep : {}),
              }}
            >
              <div style={{ ...styles.stepIcon, color }}>{meta.icon}</div>
              <div style={styles.stepInfo}>
                <div style={{ ...styles.stepLabel, color: isActive ? '#fff' : '#aaa' }}>
                  {meta.label}
                </div>
                {stepEvent?.detail && (
                  <div style={styles.stepDetail}>{stepEvent.detail}</div>
                )}
              </div>
              <div style={{ ...styles.statusDot, background: color }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1a1a1a',
    borderRadius: '8px',
    padding: '12px',
    margin: '8px 16px',
    border: '1px solid #333',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  title: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  elapsed: {
    fontSize: '12px',
    color: '#f59e0b',
    fontFamily: 'monospace',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    borderRadius: '4px',
    transition: 'background 0.2s',
  },
  activeStep: {
    background: 'rgba(245, 158, 11, 0.1)',
  },
  stepIcon: {
    fontSize: '14px',
    width: '20px',
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  stepInfo: {
    flex: 1,
    minWidth: 0,
  },
  stepLabel: {
    fontSize: '13px',
    fontWeight: 500,
  },
  stepDetail: {
    fontSize: '11px',
    color: '#666',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
};
