# Goal: processing `ready-for-agent` issues

## Prompt (current, after revisions)

Work through all open issues labeled `ready-for-agent` (the canonical label
for issues ready for an agent — check `docs/agents/triage-labels.md`; if this
repo uses a different label string for the same meaning, use that one and
note in the summary that the name differed).

Order: ascending by issue number (lower numbers are sometimes dependencies
for higher ones — check this, but absent other signals, ascending order is a
safe default).

For EACH issue:
1. Before launching the subagent, run `git pull origin master`, so the next
   subagent starts from the current state of master.
2. Launch a separate subagent (Task tool) and delegate to it:
   a. Reading issue #N (`gh issue view N`) and the relevant domain context
      (`CONTEXT.md`, `docs/adr/`) if the issue refers to them.
   b. If the issue describes a concrete feature to implement: implement it
      via `/tdd` (Skill tool, skill "tdd"), run `npm test`, and only once
      green, commit and push to master (no branch/PR — this project commits
      directly to master; on push conflict, run `git pull --rebase` and
      retry).
   c. If the issue is an epic/PRD with no discrete scope of its own to
      implement (e.g. its entire scope is already covered by other, closed
      issues) — the subagent must verify this (check the state of related
      issues, run `npm test` as a sanity check) and must NOT invent an
      artificial scope to implement.
   c2. If the issue is a PRD/epic bundling several named sub-features (e.g.
      "X, Y, and Z"), (b) and (c) are not mutually exclusive: the subagent
      must evaluate EACH named sub-feature independently — some may already
      be covered (verify only, don't touch), others may genuinely be
      missing (implement via TDD). Do not force the whole issue into one
      binary bucket ("epic" vs. "feature") — that leads either to a false
      FAIL/skip despite missing work, or to inventing unnecessary scope
      where something already exists.
   d. In both cases, the subagent (not the main session) runs
      `gh issue close N` with a comment summarizing what was done — issue
      closures must always go through the subagent, never directly through
      the main session.
   e. If it hits a real blocker (ambiguous requirements, missing credentials
      for external services, conflict with a previously merged issue) — it
      must stop and report FAIL with a concrete reason, without committing
      unfinished work.
3. The subagent returns ONLY: issue number + PASS/FAIL + one sentence, in
   the format: "Issue #N: PASS - <sentence>" or "Issue #N: FAIL - <sentence>".

You (the main session) keep only these summaries — don't pull the
subagent's implementation details into your context. Move to the next issue
only once the previous one is PASS. If a subagent returns FAIL — stop and
report it to the user instead of continuing.

Once there are no more open issues with this label: before declaring done,
launch one more, final subagent for end-to-end verification. It should read
the master ticket/PRD (if the processed issues referred to a shared
epic/PRD) together with all issues processed in this session, and check
whether the scope described in the PRD is actually implemented in the code
(not just "issue closed", but actually present in the repo) — including
running `npm test` as a sanity check. If it finds a gap (something in the
PRD not covered by any issue, or an issue closed without matching code) —
it must report this as a separate new finding (e.g. a new issue labeled
`needs-triage`), not silently skip it. The subagent returns one sentence:
"Final verification: PASS/FAIL - <sentence>".

Stop once there are no more open issues with this label AND the final
verification returned PASS (or FAIL was reported and relayed to the user).
Stop after 40 turns.

## Changelog

**2026-07-01 — added step c2.** Only one issue was encountered during the
run (#17, "PRD: Edge deletion, Handle-Spawned Nodes, and legible handle
icons") — a PRD bundling three named sub-features. It didn't fit the
original binary split between (b) "feature to implement" and (c) "epic
already fully covered": one sub-feature (edge deletion) was already done,
two others (Handle-Spawned Nodes, legible handle icons) genuinely needed
implementing, and along the way the subagent found and fixed a real bug (a
Static Media Reference handle that never re-measured after asset
selection). The subagent handled this correctly despite the ambiguity, but
leaving it undocumented could tempt a future subagent to misclassify a
whole PRD as a pure epic (skipping missing work) or to report a false FAIL
for "ambiguous requirements". Step c2 makes explicit that sub-features must
be evaluated individually.

Otherwise the run finished with no FAILs, no push conflicts, and no need for
user intervention — the rest of the prompt didn't need changes.

**2026-07-01 — added the final verification step**, per user question. The
original prompt just ended at "no more open issues" — nothing checked
whether the sum of closed issues actually covers the full scope of the
master ticket/PRD (an issue being closed is not proof the code delivers what
the PRD promised). In this particular run it mattered less, since only one
issue was encountered (itself the PRD), and its subagent already verified
coverage per sub-feature. But for a PRD split across many separate issues,
that "whole vs. sum of parts" check wouldn't be anyone's job — hence adding
it as a dedicated, final step before ending the loop.

Note: this repo has no formal "master ticket → linked sub-issues" tracker
feature (see `docs/agents/issue-tracker.md`) — a "PRD" is just a regular
GitHub issue, and any master/sub-issue relationship is implicit, inferred
from titles/bodies rather than a tracked field. The final verification step
above accounts for this by treating "master ticket/PRD" as conditional
(only when applicable), not as something to look up structurally.
