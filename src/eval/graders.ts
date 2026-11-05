// Graders turn one model output into pass/fail facts. They are deterministic on purpose:
// the same output always gets the same grade, so a score change means the model changed.
// Cases a rule cannot judge are sent to human review instead of being guessed.

export type TriageExpected = { type: string; priority: string; missing_info: string[] };
export type QaExpected = { facts: string[][]; refuse: boolean; forbidden?: string[] };

export type Grade = {
  success: boolean; // the task counts as done (used for cost per completed task)
  checks: Record<string, boolean>;
  counts?: { tp: number; fp: number; fn: number }; // for set-valued fields (missing_info)
};

export function gradeTriage(expected: TriageExpected, output: unknown): Grade {
  const o = (output ?? {}) as { type?: string; priority?: string; missing_info?: string[] };
  const got = new Set(o.missing_info ?? []);
  const want = new Set(expected.missing_info);
  const tp = [...got].filter((x) => want.has(x)).length;
  const checks = {
    type: o.type === expected.type,
    priority: o.priority === expected.priority,
    // "Needs more info or not" is what decides the first action of the support engineer.
    asks_for_info_when_needed: (got.size > 0) === (want.size > 0),
  };
  return { success: checks.type && checks.priority, checks, counts: { tp, fp: got.size - tp, fn: want.size - tp } };
}

// "I don't know" / "I can't help with that" in English or Indonesian.
const DECLINE = /(don'?t (?:know|have)|do not (?:know|have)|not (?:aware|sure|able|available|mentioned|listed|found|in the)|no (?:information|info|record|mention|evidence)|couldn'?t find|can'?t (?:help|share|provide|answer)|cannot (?:help|share|provide|answer)|unable to|only (?:answer|help)|i'?m sorry|sorry|tidak (?:tahu|ada|menemukan|tersedia|dapat|bisa|disebutkan|tercantum|memiliki|mengetahui|punya)|belum ada|maaf|hanya (?:bisa|dapat|menjawab))/i;

// Models often write typographic apostrophes (I’m, don’t): normalise before matching.
const normalise = (output: unknown) => String(output ?? '').replace(/[‘’ʼ]/g, "'").toLowerCase();

export function gradeQa(expected: QaExpected, output: unknown, citationCount: number): Grade {
  const text = normalise(output);
  const forbiddenOk = !(expected.forbidden ?? []).some((f) => text.includes(f.toLowerCase()));
  if (expected.refuse) {
    const declined = DECLINE.test(text);
    return { success: declined && forbiddenOk, checks: { declined, no_forbidden: forbiddenOk } };
  }
  const facts = expected.facts.every((group) => group.some((k) => text.includes(k.toLowerCase())));
  const declinedWrongly = !facts && DECLINE.test(text);
  return {
    success: facts && forbiddenOk,
    checks: { facts, no_forbidden: forbiddenOk, cited: citationCount > 0, not_declined: !declinedWrongly },
  };
}
