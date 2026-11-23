import { AlertTriangle } from 'lucide-react';

// The warning heading of the terms panel, shared by the approval step and the Save step (one icon, one wording).
export default function TermsHeading() {
  return <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning-fg"><AlertTriangle aria-label="Warning" role="img" size={16} className="shrink-0" />Terms and conditions</p>;
}
