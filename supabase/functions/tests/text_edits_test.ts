import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { applyTextEdits } from '../api/lib/text_edits.ts';
import { ApiError } from '../api/lib/http.ts';

Deno.test('edits preserve whitespace, CRLF, Unicode, and literal replacement characters', () => {
  assertEquals(applyTextEdits('  café\r\nend', [{ old_text: 'café', new_text: '$&🙂' }], 'a'), '  $&🙂\r\nend');
});
Deno.test('edits run sequentially and allow deletion or explicit replace_all', () => {
  assertEquals(applyTextEdits('a a', [{ old_text: 'a', new_text: 'b', replace_all: true }, { old_text: 'b b', new_text: '' }], 'a'), '');
});
Deno.test('ambiguous and overlapping matches fail; a missing match never inserts text', () => {
  for (const content of ['abc abc', 'abcabc']) {
    const err = assertThrows(() => applyTextEdits(content, [{ old_text: 'abc', new_text: 'x' }], 'a'), ApiError);
    assertEquals(err.code, 'edit_ambiguous');
  }
  assertEquals(assertThrows(() => applyTextEdits('aaa', [{ old_text: 'aa', new_text: 'x' }], 'a'), ApiError).code, 'edit_ambiguous');
  assertEquals(assertThrows(() => applyTextEdits('a', [{ old_text: 'b', new_text: 'x' }], 'a'), ApiError).code, 'edit_not_found');
});
Deno.test('invalid edits fail with actionable input errors', () => {
  for (const edits of [[], null, [{ old_text: '', new_text: 'a' }], [{ old_text: 'a' }], [{ old_text: 'a', new_text: 'b', replace_all: 'false' }]]) {
    assertEquals(assertThrows(() => applyTextEdits('a', edits, 'a'), ApiError).status, 400);
  }
});
Deno.test('replacement expansion is rejected before building a huge string', () => {
  assertEquals(assertThrows(() => applyTextEdits('a'.repeat(10000), [{ old_text: 'a', new_text: 'b'.repeat(10000), replace_all: true }], 'a'), ApiError).status, 413);
});
