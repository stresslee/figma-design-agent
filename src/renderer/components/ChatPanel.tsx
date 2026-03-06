import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, PipelineStepEvent, AttachmentData } from '../../shared/types';
import { PipelineProgress } from './PipelineProgress';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const DOCUMENT_EXTENSIONS = ['txt', 'md', 'json', 'csv', 'rtf'];
const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const DOC_MEDIA_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  rtf: 'text/rtf',
};

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix: "data:image/png;base64,..."
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export async function processFile(file: File): Promise<AttachmentData | null> {
  const ext = getFileExtension(file.name);
  if (!ALL_EXTENSIONS.includes(ext)) return null;

  if (IMAGE_EXTENSIONS.includes(ext)) {
    const base64 = await readFileAsBase64(file);
    return {
      type: 'image',
      mediaType: IMAGE_MEDIA_TYPES[ext] || 'image/png',
      base64,
      name: file.name,
      size: file.size,
    };
  }

  // Document
  const textContent = await readFileAsText(file);
  return {
    type: 'document',
    mediaType: DOC_MEDIA_TYPES[ext] || 'text/plain',
    base64: '',
    name: file.name,
    size: file.size,
    textContent,
  };
}

interface Props {
  messages: ChatMessage[];
  onSendMessage: (message: string, attachments?: AttachmentData[]) => void;
  isLoading: boolean;
  pipelineSteps?: PipelineStepEvent[];
  pendingAttachments?: AttachmentData[];
  onClearPendingAttachments?: () => void;
  inputMode?: 'terminal' | 'app';
}

// Inject keyframes once
const STYLE_ID = 'chat-dot-bounce';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes dotBounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40% { transform: translateY(-6px); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export function ChatPanel({ messages, onSendMessage, isLoading, pipelineSteps = [], pendingAttachments, onClearPendingAttachments, inputMode = 'app' }: Props) {
  const isTerminalMode = inputMode === 'terminal';
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Merge pending attachments from global drag-and-drop
  useEffect(() => {
    if (pendingAttachments && pendingAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...pendingAttachments]);
      onClearPendingAttachments?.();
    }
  }, [pendingAttachments, onClearPendingAttachments]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const newAttachments: AttachmentData[] = [];
    for (const file of Array.from(files)) {
      const attachment = await processFile(file);
      if (attachment) {
        newAttachments.push(attachment);
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = ''; // reset so same file can be selected again
    }
  }, [handleFiles]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;
    onSendMessage(trimmed || '(첨부 파일)', attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFiles(imageFiles);
    }
    // If no images, default text paste behavior is preserved
  }, [handleFiles]);

  const canSend = (input.trim() || attachments.length > 0) && !isLoading && !isTerminalMode;

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
            {msg.attachments && msg.attachments.length > 0 && (
              <div style={styles.messageAttachments}>
                {msg.attachments.map((att, i) => (
                  <div key={i} style={styles.messageAttachment}>
                    {att.type === 'image' ? (
                      <img
                        src={`data:${att.mediaType};base64,${att.base64}`}
                        alt={att.name}
                        style={styles.messageAttachmentImg}
                      />
                    ) : (
                      <div style={styles.messageAttachmentDoc}>
                        <span style={styles.docIcon}>&#128196;</span>
                        <span style={styles.docName}>{att.name}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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

        {pipelineSteps.length > 0 && (
          <PipelineProgress steps={pipelineSteps} />
        )}

        {isLoading && (
          <div style={styles.loadingIndicator}>
            <div style={styles.dot} />
            <div style={{ ...styles.dot, animationDelay: '0.2s' }} />
            <div style={{ ...styles.dot, animationDelay: '0.4s' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {isTerminalMode && (
        <div style={{
          padding: '10px 16px',
          background: '#1a1a2e',
          borderTop: '1px solid #333',
          color: '#8b8ba7',
          fontSize: '13px',
          textAlign: 'center' as const,
        }}>
          Terminal mode — Claude Code에서 입력하세요
        </div>
      )}

      {/* Input area */}
      <div style={styles.inputArea}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALL_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div style={styles.attachmentPreviews}>
            {attachments.map((att, i) => (
              <div key={i} style={styles.attachmentPreview}>
                {att.type === 'image' ? (
                  <img
                    src={`data:${att.mediaType};base64,${att.base64}`}
                    alt={att.name}
                    style={styles.attachmentThumb}
                  />
                ) : (
                  <div style={styles.attachmentDocPreview}>
                    <span style={styles.docIcon}>&#128196;</span>
                    <span style={styles.attachmentDocName}>{att.name}</span>
                  </div>
                )}
                <button
                  style={styles.attachmentRemove}
                  onClick={() => removeAttachment(i)}
                  title="Remove"
                >
                  &#x2715;
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={styles.inputWrapper}>
          <button
            style={styles.attachButton}
            onClick={handleFileSelect}
            disabled={isLoading || isTerminalMode}
            title="파일 첨부"
          >
            +
          </button>
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isTerminalMode ? "터미널 모드 — Figma 플러그인에서 App 모드로 전환하세요" : "Describe your design..."}
            rows={1}
            disabled={isLoading || isTerminalMode}
          />
          <button
            style={{
              ...styles.sendButton,
              ...(canSend ? styles.sendButtonActive : {}),
            }}
            onClick={handleSubmit}
            disabled={!canSend}
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
    background: '#888',
    animation: 'dotBounce 1.4s infinite ease-in-out',
  },
  messageAttachments: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
    marginBottom: '8px',
  },
  messageAttachment: {
    borderRadius: '8px',
    overflow: 'hidden',
  },
  messageAttachmentImg: {
    maxWidth: '200px',
    maxHeight: '150px',
    borderRadius: '8px',
    display: 'block',
  },
  messageAttachmentDoc: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '6px',
    fontSize: '12px',
  },
  docIcon: {
    fontSize: '14px',
  },
  docName: {
    color: '#ccc',
    maxWidth: '150px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  inputArea: {
    padding: '12px 16px',
    borderTop: '1px solid #222',
    background: '#0f0f0f',
    flexShrink: 0,
    position: 'relative' as const,
    transition: 'border-color 0.15s ease',
  },
  attachmentPreviews: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
    marginBottom: '8px',
  },
  attachmentPreview: {
    position: 'relative' as const,
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid #333',
    background: '#1e1e1e',
  },
  attachmentThumb: {
    width: '64px',
    height: '64px',
    objectFit: 'cover' as const,
    display: 'block',
  },
  attachmentDocPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '8px 12px',
    height: '64px',
    boxSizing: 'border-box' as const,
  },
  attachmentDocName: {
    fontSize: '11px',
    color: '#aaa',
    maxWidth: '80px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  attachmentRemove: {
    position: 'absolute' as const,
    top: '2px',
    right: '2px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  attachButton: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    border: 'none',
    background: '#333',
    color: '#999',
    fontSize: '18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
    lineHeight: 1,
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
