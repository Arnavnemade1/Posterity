import { expect, test } from 'bun:test';
import { recoveryChecks } from '../../web/src/lib/recovery-review';
function form() {
  const f = new FormData();
  f.append('recovery_id', 'recovery-1');
  f.set('recovery_recovery-1_checked', 'on');
  f.append('recovery_recovery-1_objection', 'objection-1');
  f.set('objection_objection-1_upheld', 'false');
  f.set('objection_objection-1_rationale', 'The archived claim is contradicted by the recorded evidence.');
  return f;
}
test('explicit objection disposition survives form parsing without truthy-string coercion', () => {
  expect(recoveryChecks(form())).toEqual([{name:'Recovered round reviewed',recovery_id:'recovery-1',passed:true,objections:[{
    objection_id:'objection-1',upheld:false,rationale:'The archived claim is contradicted by the recorded evidence.',
  }]}]);
});
test('an unchecked archived round cannot be approved', () => {
  const f=form(); f.delete('recovery_recovery-1_checked');
  expect(() => recoveryChecks(f)).toThrow('Check each recovered round');
});
test('missing decisions, blank rationales and duplicate rounds fail closed', () => {
  for (const value of ['', 'yes']) {const f=form(); f.set('objection_objection-1_upheld',value); expect(() => recoveryChecks(f)).toThrow();}
  const blank=form(); blank.set('objection_objection-1_rationale','          '); expect(() => recoveryChecks(blank)).toThrow();
  const duplicate=form(); duplicate.append('recovery_id','recovery-1'); expect(() => recoveryChecks(duplicate)).toThrow();
});
