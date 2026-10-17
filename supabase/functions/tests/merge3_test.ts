// Line merges and rename pairing (lib/merge3.ts): what the code worker computes for merges.
//
//   npx deno@2 test --no-lock --node-modules-dir=none --allow-env supabase/functions/tests/
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { merge3, pairRenames, similarity, splitLines } from '../api/lib/merge3.ts';

const lines = (...l: string[]) => l.map((x) => `${x}\n`).join('');

Deno.test('splitLines keeps line endings and a last line without one', () => {
  assertEquals(splitLines('a\nb\nc'), ['a\n', 'b\n', 'c']);
  assertEquals(splitLines('a\n\n'), ['a\n', '\n']);
  assertEquals(splitLines(''), []);
  assertEquals(splitLines('a\nb\nc').join(''), 'a\nb\nc');
});

Deno.test('one side changed: take it', () => {
  const base = lines('a', 'b');
  assertEquals(merge3(base, base, lines('a', 'B')), { conflict: false, text: lines('a', 'B'), hunks: 0 });
  assertEquals(merge3(base, lines('A', 'b'), base), { conflict: false, text: lines('A', 'b'), hunks: 0 });
  assertEquals(merge3(base, lines('x'), lines('x')), { conflict: false, text: lines('x'), hunks: 0 });
});

Deno.test('separate lines merge cleanly', () => {
  const base = lines('1', '2', '3', '4', '5', '6');
  const ours = lines('1 ours', '2', '3', '4', '5', '6');
  const theirs = lines('1', '2', '3', '4', '5', '6 theirs');
  assertEquals(merge3(base, ours, theirs), { conflict: false, text: lines('1 ours', '2', '3', '4', '5', '6 theirs'), hunks: 0 });
});

Deno.test('insertions in different places and a deletion combine', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const ours = lines('top', 'a', 'b', 'c', 'd', 'e');
  const theirs = lines('a', 'b', 'd', 'e', 'bottom');
  assertEquals(merge3(base, ours, theirs)?.text, lines('top', 'a', 'b', 'd', 'e', 'bottom'));
});

Deno.test('the same change on both sides is no conflict', () => {
  const base = lines('a', 'b', 'c');
  const both = lines('a', 'B', 'c');
  assertEquals(merge3(base, both, lines('a', 'B', 'c', 'd'))?.conflict, false);
  assertEquals(merge3(base, both, lines('a', 'B', 'c', 'd'))?.text, lines('a', 'B', 'c', 'd'));
});

Deno.test('overlapping changes conflict with diff3 markers', () => {
  const base = lines('a', 'b', 'c');
  const r = merge3(base, lines('a', 'ours', 'c'), lines('a', 'theirs', 'c'))!;
  assert(r.conflict);
  assertEquals(r.hunks, 1);
  assertEquals(r.text, lines('a', '<<<<<<< ours', 'ours', '||||||| base', 'b', '=======', 'theirs', '>>>>>>> theirs', 'c'));
});

Deno.test('changes to adjacent lines conflict, as in git', () => {
  const base = lines('a', 'b', 'c', 'd');
  const r = merge3(base, lines('a', 'B', 'c', 'd'), lines('a', 'b', 'C', 'd'))!;
  assert(r.conflict);
});

Deno.test('a file new on both sides with different content conflicts', () => {
  const r = merge3('', lines('one'), lines('two'))!;
  assert(r.conflict);
  assert(r.text.includes('<<<<<<< ours\none\n||||||| base\n=======\ntwo\n>>>>>>> theirs\n'));
});

Deno.test('a missing final newline survives a clean merge and is closed in markers', () => {
  assertEquals(merge3('a\nb', 'A\nb', 'a\nb\nc')?.conflict, true);
  assertEquals(merge3('x\na\nb\nc', 'X\na\nb\nc', 'x\na\nb\nC')?.text, 'X\na\nb\nC');
});

Deno.test('several conflicts are counted', () => {
  const base = lines('1', '2', '3', '4', '5', '6', '7');
  const r = merge3(base, lines('A', '2', '3', '4', '5', '6', 'G'), lines('a', '2', '3', '4', '5', '6', 'g'))!;
  assertEquals(r.hunks, 2);
});

Deno.test('similarity counts shared non-blank lines', () => {
  assertEquals(similarity(lines('a', 'b', 'c', 'd'), lines('a', 'b', 'c', 'd')), 1);
  assertEquals(similarity(lines('a', 'b', '', 'c', 'd'), lines('a', 'b', 'x', 'y')), 0.5);
  assertEquals(similarity('', lines('a')), 0);
});

Deno.test('pairRenames finds moved and edited files, one to one, best first', () => {
  const body = lines('export function widget() {', '  return 1;', '}', '', 'export const name = "w";');
  const pairs = pairRenames(
    [{ path: 'src/widget.ts', text: body }, { path: 'src/gone.ts', text: lines('unrelated', 'content', 'here') }],
    [
      { path: 'lib/widget.ts', text: body.replace('return 1', 'return 2') },
      { path: 'lib/other.ts', text: body.replace('widget', 'gadget').replace('return 1', 'return 3').replace('"w"', '"g"') },
    ],
  );
  assertEquals(pairs, { 'src/widget.ts': 'lib/widget.ts' });
});

Deno.test('pairRenames ignores files of very different sizes', () => {
  assertEquals(pairRenames([{ path: 'a.txt', text: lines('x') }], [{ path: 'b.txt', text: lines('x', ...Array(50).fill('y')) }]), {});
});
