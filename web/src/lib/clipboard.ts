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
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
