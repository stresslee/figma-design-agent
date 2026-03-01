import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../shared/types';

interface Props {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function ChatPanel({ messages, onSendMessage, isLoading }: Props) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={styles.container}>
      {/* Messages area */}
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>&#9670;</div>
            <div style={styles.emptyTitle}>Figma Design Agent</div>
            <div style={styles.emptySubtitle}>
              Describe what you want to design, and I'll create it in Figma.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.message,
              ...(msg.role === 'user' ? styles.userMessage : styles.assistantMessage),
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div style={styles.messageContent}>
              {msg.content}
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={styles.toolCalls}>
                {msg.toolCalls.map((tc, i) => (
                  <div key={i} style={styles.toolCall}>
                    <span style={styles.toolCallName}>{tc.name}</span>
                    {tc.duration && (
                      <span style={styles.toolCallDuration}>{tc.duration}ms</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div style={styles.loadingIndicator}>
            <div style={styles.dot} />
            <div style={{ ...styles.dot, animationDelay: '0.2s' }} />
            <div style={{ ...styles.dot, animationDelay: '0.4s' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your design..."
            rows={1}
            disabled={isLoading}
          />
          <button
            style={{
              ...styles.sendButton,
              ...(input.trim() && !isLoading ? styles.sendButtonActive : {}),
            }}
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
          >
            &#x2191;
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '8px',
    opacity: 0.5,
  },
  emptyIcon: {
    fontSize: '32px',
    color: '#666',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#999',
  },
  emptySubtitle: {
    fontSize: '13px',
    color: '#666',
    maxWidth: '300px',
    textAlign: 'center' as const,
  },
  message: {
    padding: '12px 16px',
    borderRadius: '12px',
    maxWidth: '85%',
    lineHeight: 1.5,
    fontSize: '14px',
  },
  userMessage: {
    alignSelf: 'flex-end',
    background: '#2563eb',
    color: '#fff',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    background: '#1e1e1e',
    color: '#e0e0e0',
  },
  messageRole: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    opacity: 0.6,
    marginBottom: '4px',
  },
  messageContent: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  toolCalls: {
    marginTop: '8px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
  },
  toolCall: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.08)',
    fontSize: '11px',
  },
  toolCallName: {
    fontFamily: 'monospace',
    color: '#8b5cf6',
  },
  toolCallDuration: {
    color: '#666',
  },
  loadingIndicator: {
    display: 'flex',
    gap: '4px',
    padding: '12px 16px',
    alignSelf: 'flex-start',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#555',
    animation: 'pulse 1.4s infinite ease-in-out',
  },
  inputArea: {
    padding: '12px 16px',
    borderTop: '1px solid #222',
    background: '#0f0f0f',
    flexShrink: 0,
  },
  inputWrapper: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    background: '#1e1e1e',
    borderRadius: '12px',
    padding: '8px 12px',
    border: '1px solid #333',
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e0e0e0',
    fontSize: '14px',
    lineHeight: '1.5',
    resize: 'none' as const,
    fontFamily: 'inherit',
    maxHeight: '200px',
  },
  sendButton: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: 'none',
    background: '#333',
    color: '#666',
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  },
  sendButtonActive: {
    background: '#2563eb',
    color: '#fff',
  },
};
