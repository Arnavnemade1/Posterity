/**
 * Copies text. The async clipboard needs a secure page and a user gesture; where it refuses (an older browser, an
 * embedded view), a hidden field and the legacy copy command still work. Resolves false when neither does, so the
 * caller can ask the person to copy by hand instead of showing a dialog.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path.
  }
  if (typeof document === 'undefined') return false;
  const field = document.createElement('textarea');
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  try {
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    // A modal makes the rest of the document inert, including a field on the body.
    const modal = focused instanceof Element ? focused.closest('dialog[open]') : null;
    (modal ?? [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body).appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
