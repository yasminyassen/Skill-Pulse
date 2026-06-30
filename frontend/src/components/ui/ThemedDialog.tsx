import { AlertTriangle, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type DialogTone = "default" | "danger";

interface BaseDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  accent?: string;
  tone?: DialogTone;
  cancelLabel?: string;
  confirmLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface TextareaDialogProps extends BaseDialogProps {
  value: string;
  placeholder?: string;
  minHeight?: number;
  onChange: (value: string) => void;
}

const toneColor = (tone: DialogTone, accent: string) => tone === "danger" ? "#ef4444" : accent;

export function ConfirmDialog({
  open,
  title,
  description,
  accent = "#8b5cf6",
  tone = "default",
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  loading = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: BaseDialogProps) {
  if (!open) return null;
  const color = toneColor(tone, accent);
  return (
    <div className="sp-dialog-overlay" role="presentation">
      <style>{dialogStyles}</style>
      <section className="sp-dialog-card" role="dialog" aria-modal="true" aria-labelledby="sp-dialog-title" style={{ "--dialog-accent": color } as CSSProperties}>
        <button className="sp-dialog-close" type="button" onClick={onCancel} aria-label="Close dialog" disabled={loading}>
          <X size={17} />
        </button>
        <div className="sp-dialog-icon"><AlertTriangle size={22} /></div>
        <h2 id="sp-dialog-title">{title}</h2>
        {description && <div className="sp-dialog-description">{description}</div>}
        <div className="sp-dialog-actions">
          <button className="sp-dialog-btn secondary" type="button" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button className="sp-dialog-btn primary" type="button" onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function TextareaDialog({
  open,
  title,
  description,
  value,
  placeholder,
  minHeight = 150,
  accent = "#8b5cf6",
  cancelLabel = "Cancel",
  confirmLabel = "Save",
  loading = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  onChange,
}: TextareaDialogProps) {
  if (!open) return null;
  return (
    <div className="sp-dialog-overlay" role="presentation">
      <style>{dialogStyles}</style>
      <section className="sp-dialog-card wide" role="dialog" aria-modal="true" aria-labelledby="sp-dialog-title" style={{ "--dialog-accent": accent } as CSSProperties}>
        <button className="sp-dialog-close" type="button" onClick={onCancel} aria-label="Close dialog" disabled={loading}>
          <X size={17} />
        </button>
        <h2 id="sp-dialog-title">{title}</h2>
        {description && <div className="sp-dialog-description">{description}</div>}
        <textarea
          className="sp-dialog-textarea"
          value={value}
          placeholder={placeholder}
          onChange={event => onChange(event.target.value)}
          style={{ minHeight }}
          autoFocus
        />
        <div className="sp-dialog-actions">
          <button className="sp-dialog-btn secondary" type="button" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button className="sp-dialog-btn primary" type="button" onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading ? "Saving..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

const dialogStyles = `
  .sp-dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(2, 6, 23, 0.72);
    backdrop-filter: blur(10px);
    animation: spDialogFade 0.18s ease-out;
  }

  .sp-dialog-card {
    --dialog-accent: #8b5cf6;
    position: relative;
    width: min(100%, 460px);
    border: 1px solid var(--border-hover, var(--border));
    border-radius: 20px;
    padding: 26px;
    background: var(--bg-sidebar, var(--bg-card));
    color: var(--text-primary);
    box-shadow: var(--shadow-card, 0 24px 70px rgba(0,0,0,0.35));
    animation: spDialogZoom 0.18s ease-out;
  }

  .sp-dialog-card.wide {
    width: min(100%, 560px);
  }

  .sp-dialog-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border);
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--bg-card-hover, transparent);
    cursor: pointer;
    transition: border-color 0.16s, color 0.16s, background 0.16s;
  }

  .sp-dialog-close:hover {
    border-color: color-mix(in srgb, var(--dialog-accent) 55%, transparent);
    color: var(--dialog-accent);
    background: color-mix(in srgb, var(--dialog-accent) 11%, transparent);
  }

  .sp-dialog-icon {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    margin-bottom: 16px;
    color: var(--dialog-accent);
    background: color-mix(in srgb, var(--dialog-accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--dialog-accent) 24%, transparent);
  }

  .sp-dialog-card h2 {
    margin: 0;
    padding-right: 34px;
    color: var(--text-primary);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 20px;
    font-weight: 850;
    line-height: 1.25;
  }

  .sp-dialog-description {
    margin-top: 10px;
    color: var(--text-secondary);
    font-size: 13.5px;
    line-height: 1.65;
  }

  .sp-dialog-textarea {
    width: 100%;
    margin-top: 16px;
    padding: 13px 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    box-sizing: border-box;
    resize: vertical;
    outline: none;
    background: var(--bg-input);
    color: var(--text-primary);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    transition: border-color 0.16s, box-shadow 0.16s;
  }

  .sp-dialog-textarea:focus {
    border-color: color-mix(in srgb, var(--dialog-accent) 62%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--dialog-accent) 13%, transparent);
  }

  .sp-dialog-textarea::placeholder {
    color: var(--text-faint);
  }

  .sp-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 22px;
    flex-wrap: wrap;
  }

  .sp-dialog-btn {
    min-height: 42px;
    border-radius: 12px;
    padding: 0 18px;
    border: 1px solid var(--border);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.16s, opacity 0.16s, border-color 0.16s, background 0.16s;
  }

  .sp-dialog-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .sp-dialog-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .sp-dialog-btn.secondary {
    background: var(--bg-card-hover);
    color: var(--text-secondary);
  }

  .sp-dialog-btn.primary {
    border-color: color-mix(in srgb, var(--dialog-accent) 45%, transparent);
    color: white;
    background: linear-gradient(135deg, var(--dialog-accent), color-mix(in srgb, var(--dialog-accent) 72%, #ec4899));
    box-shadow: 0 12px 30px color-mix(in srgb, var(--dialog-accent) 22%, transparent);
  }

  @keyframes spDialogFade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes spDialogZoom {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (max-width: 560px) {
    .sp-dialog-card {
      padding: 22px;
      border-radius: 18px;
    }

    .sp-dialog-actions {
      display: grid;
      grid-template-columns: 1fr;
    }
  }
`;
