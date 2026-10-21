export interface RecoveryEvidence {
  id: string;
  round: number;
  operator: string;
  reason: string;
  contributions: { id: string; role: string; kind: string; summary: string; content: string }[];
}

export type RecoveryReview = { id: string; round: number; objections: { id: string; summary: string }[] };

/** Form fields are untrusted; the database checks the authoritative recovery/objection sets. */
export function recoveryChecks(form: FormData) {
  const ids = form.getAll('recovery_id');
  if (ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Invalid recovered rounds. Reload the page.');
  return ids.map((id) => {
    if (typeof id !== 'string' || form.get(`recovery_${id}_checked`) !== 'on') {
      throw new Error('Check each recovered round before approving.');
    }
    const objections = form.getAll(`recovery_${id}_objection`).map((objection) => {
      if (typeof objection !== 'string') throw new Error('Invalid objection. Reload the page.');
      const upheld = form.get(`objection_${objection}_upheld`);
      const rationale = form.get(`objection_${objection}_rationale`);
      if (!['true', 'false'].includes(String(upheld)) || typeof rationale !== 'string' || rationale.trim().length < 10 || rationale.trim().length > 8000) {
        throw new Error('Assess each archived objection and explain your decision (10–8,000 characters).');
      }
      return { objection_id: objection, upheld: upheld === 'true', rationale: rationale.trim() };
    });
    return { name: 'Recovered round reviewed', recovery_id: id, passed: true, objections };
  });
}
