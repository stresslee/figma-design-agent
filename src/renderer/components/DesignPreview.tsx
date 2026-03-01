import React, { useState, useEffect } from 'react';

interface Props {
  screenshotBase64?: string;
}

export function DesignPreview({ screenshotBase64 }: Props) {
  if (!screenshotBase64) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>No preview</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Preview</span>
      </div>
      <div style={styles.imageWrapper}>
        <img
          src={`data:image/png;base64,${screenshotBase64}`}
          alt="Design preview"
          style={styles.image}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
  },
  title: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#888',
  },
  imageWrapper: {
    padding: '0 16px',
  },
  image: {
    width: '100%',
    borderRadius: '8px',
    border: '1px solid #222',
  },
  empty: {
    padding: '20px',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '12px',
    color: '#444',
  },
};
