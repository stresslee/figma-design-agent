import React from 'react';
import type { FigmaConnectionState, DSCacheStatus } from '../../shared/types';

interface SplashScreenProps {
  figmaStatus: FigmaConnectionState;
  dsCacheStatus: DSCacheStatus;
}

function Step({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 0',
      opacity: done || active ? 1 : 0.35,
    }}>
      <span style={{ fontSize: '14px', width: '18px', textAlign: 'center' }}>
        {done ? '\u2713' : active ? '' : '\u2022'}
      </span>
      {active && !done && <Spinner />}
      <span style={{
        fontSize: '13px',
        color: done ? '#22c55e' : active ? '#e0e0e0' : '#666',
      }}>
        {label}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: '14px',
      height: '14px',
      border: '2px solid #333',
      borderTopColor: '#22c55e',
      borderRadius: '50%',
      animation: 'splash-spin 0.8s linear infinite',
    }} />
  );
}

export function SplashScreen({ figmaStatus, dsCacheStatus }: SplashScreenProps) {
  const figmaConnected = figmaStatus.status === 'connected';

  return (
    <div style={styles.container}>
      <style>{`@keyframes splash-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={styles.card}>
        <h1 style={styles.title}>Figma Design Agent</h1>

        <div style={styles.steps}>
          <Step
            label={figmaConnected
              ? `Figma \uC5F0\uACB0\uB428 (${figmaStatus.documentName || figmaStatus.channel})`
              : 'Figma \uC5F0\uACB0 \uC911...'}
            done={figmaConnected}
            active={!figmaConnected}
          />
          <Step
            label={dsCacheStatus.status === 'done'
              ? `\uB514\uC790\uC778 \uC2DC\uC2A4\uD15C \uB85C\uB529 \uC644\uB8CC`
              : dsCacheStatus.status === 'error'
                ? '\uB514\uC790\uC778 \uC2DC\uC2A4\uD15C \uB85C\uB529 \uC2E4\uD328'
                : '\uB514\uC790\uC778 \uC2DC\uC2A4\uD15C \uB85C\uB529 \uC911...'}
            done={dsCacheStatus.status === 'done'}
            active={figmaConnected && (dsCacheStatus.status === 'caching' || dsCacheStatus.status === 'idle')}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0f0f0f',
  },
  card: {
    textAlign: 'center',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e0e0e0',
    letterSpacing: '-0.02em',
    marginBottom: '32px',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
  },
};
