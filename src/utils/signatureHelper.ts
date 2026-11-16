import { SchoolProfile } from '../types';

export function isValidSignatureSrc(src?: string | null): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  return (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  );
}

function escapeHtmlAttr(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generates safe HTML markup for the Principal signature image (or styled text fallback)
 * used in standalone printable HTML reports (Merit Lists, Due Lists, Document Vault).
 */
export function buildPrincipalSignatureHtml(
  school?: Partial<SchoolProfile> | null,
  fallbackText = ''
): string {
  const sigUrl = school?.principalSignatureUrl?.trim();
  const principalName = school?.principalNameEn?.trim() || school?.principalNameBn?.trim() || fallbackText;

  if (isValidSignatureSrc(sigUrl)) {
    const imgHtml = `<img src="${escapeHtmlAttr(sigUrl!)}" alt="Principal Signature" style="max-height:40px;max-width:160px;object-fit:contain;display:block;margin:0 auto 2px auto;" />`;
    if (principalName) {
      return `${imgHtml}<div style="font-size:10px;font-weight:700;color:#0f172a;margin-bottom:2px;">${escapeHtmlAttr(principalName)}</div>`;
    }
    return imgHtml;
  }

  if (!principalName) return '';
  return `<div style="font-style:italic;font-weight:800;margin-bottom:2px;">${escapeHtmlAttr(principalName)}</div>`;
}
