import { useRef, useCallback } from 'react';

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean | undefined;
  isStreaming?: boolean;
  placeholder?: string;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  isStreaming,
  placeholder = 'Ask DevMind…',
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && !isStreaming && value.trim()) onSubmit();
      }
    },
    [disabled, isStreaming, value, onSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Auto-resize
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }
    },
    [onChange]
  );

  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'flex-end',
        background: 'var(--bg-sidebar)',
      }}
    >
      <textarea
        ref={textareaRef}
        className="input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isStreaming}
        rows={1}
        style={{
          fontFamily: 'var(--font-sans)',
          resize: 'none',
          lineHeight: 'var(--leading-relaxed)',
          minHeight: '38px',
          overflow: 'hidden',
          borderRadius: 'var(--radius-md)',
        }}
      />
      <button
        className={`btn ${isStreaming ? 'btn-secondary' : 'btn-primary'}`}
        onClick={onSubmit}
        disabled={!value.trim() || !!disabled}
        style={{ flexShrink: 0, height: '38px' }}
        title={isStreaming ? 'Streaming…' : 'Send (Enter)'}
      >
        {isStreaming ? '⏸' : '↑'}
      </button>
    </div>
  );
}
