import { ApiError } from './http.ts';

/** Exact, sequential edits. Never guess which occurrence the agent meant. */
export function applyTextEdits(content: string, edits: unknown, path: string): string {
  if (!Array.isArray(edits) || !edits.length || edits.length > 100) {
    throw new ApiError(400, 'bad_request', `${path}: edits must contain 1–100 replacements`);
  }
  let result = content;
  for (const [index, edit] of edits.entries()) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit) ||
      typeof edit.old_text !== 'string' || !edit.old_text.length || typeof edit.new_text !== 'string' ||
      (edit.replace_all !== undefined && typeof edit.replace_all !== 'boolean')) {
      throw new ApiError(400, 'bad_request', `${path}: edit ${index + 1} needs nonempty old_text, new_text, and optional boolean replace_all`);
    }
    const first = result.indexOf(edit.old_text);
    const details = { path, edit_index: index };
    if (first === -1) {
      throw new ApiError(409, 'edit_not_found', `${path}: edit ${index + 1} does not match`,
        'Read the file at expected_head and copy the exact text, including whitespace.', details);
    }
    // Include overlapping occurrences: "aa" in "aaa" is ambiguous too.
    if (!edit.replace_all && result.indexOf(edit.old_text, first + 1) !== -1) {
      throw new ApiError(409, 'edit_ambiguous', `${path}: edit ${index + 1} matches more than once`,
        'Include more surrounding text, or explicitly set replace_all: true.', details);
    }
    // Bound expansion before allocating a replacement (e.g. a huge replace_all).
    let count = 1;
    if (edit.replace_all) {
      count = 0;
      for (let at = first; at !== -1; at = result.indexOf(edit.old_text, at + edit.old_text.length)) count++;
    }
    const encoder = new TextEncoder();
    const size = encoder.encode(result).length + count * (encoder.encode(edit.new_text).length - encoder.encode(edit.old_text).length);
    if (size > 4_000_000) throw new ApiError(413, 'payload_too_large', `${path}: edited text exceeds 4 MB`);
    // Literal replacement, including $, backslashes, and line endings.
    result = edit.replace_all
      ? result.split(edit.old_text).join(edit.new_text)
      : result.slice(0, first) + edit.new_text + result.slice(first + edit.old_text.length);
  }
  return result;
}
