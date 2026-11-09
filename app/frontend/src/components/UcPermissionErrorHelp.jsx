import { useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import TechnicalDetails, { PlainMessage } from './TechnicalDetails';
import { copyText } from '../lib/clipboard';

/**
 * Rich error panel when a failure is likely missing UC / workspace permissions.
 * @param {{ guidance: ReturnType<import('../lib/ucPermissionErrors').interpretUcPermissionError> }} props
 */
export default function UcPermissionErrorHelp({ guidance }) {
  const [copied, setCopied] = useState(false);
  if (!guidance) return null;

  const copyAdminText = async () => {
    if (!guidance.adminEmailText) return;
    try {
      await copyText(guidance.adminEmailText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!guidance.isPermissionIssue) {
    return (
      <div role="alert" className="flex items-start gap-2 p-3 bg-error-bg border border-error/20 rounded-lg mb-6">
        <AlertCircle size={16} className="text-error-fg shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <PlainMessage text={guidance.userMessage} className="text-sm text-error-fg" />
        </div>
      </div>
    );
  }

  const grants = guidance.adminBullets.map((line) => (line.startsWith('  ') ? line.trim() : line));

  return (
    <div role="alert" data-uc-permission="" className="mb-6 rounded-xl border border-error/25 bg-error-bg/80 px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="text-error-fg shrink-0 mt-0.5" />
        <p className="min-w-0 flex-1 text-sm text-error-fg">{guidance.userMessage}</p>
      </div>
      {guidance.adminEmailText && (
        <button
          type="button"
          onClick={copyAdminText}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary transition-smooth"
        >
          {copied ? <Check size={14} className="text-success-fg" /> : <Copy size={14} />}
          {copied ? 'Copied for admin' : 'Copy message for admin'}
        </button>
      )}
      <TechnicalDetails items={[...grants, '', guidance.technicalDetail]} />
    </div>
  );
}
