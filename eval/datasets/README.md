# Evaluation datasets

| File | Driver | Rows | Source | Labels |
|---|---|---|---|---|
| `ticket-triage.jsonl` | ticket-triage | 30 | Golden set from [msp-ops-copilot](https://github.com/seppam/msp-ops-copilot) (`data/golden/tickets.csv`), fictional ERP tickets in Indonesian | Reviewed by a person with 3 years of application-support experience: `type`, `priority`, `missing_info` |
| `portfolio-qa.jsonl` | portfolio-qa | 18 | Hand-written questions about the public portfolio | `facts`: groups of acceptable keywords (each group must appear); `refuse`: the answer must decline or say it does not know; `forbidden`: strings that must not appear |

Rules:
- Datasets are versioned in git. Every eval result stores the SHA-256 of the dataset file, so a result can never be compared against a different dataset by accident.
- Ambiguous rows are kept on purpose (see the `note` field in ticket-triage): they show where the task itself is hard.
- No real customer or personal data. Add new rows from production failures after anonymising them.

Change history:
- 2026-11-04: added `submitted_at` to ticket-triage inputs. Error analysis showed most `change_impact` tickets were classified as `bug`, and the model had no way to relate a ticket to a change without its date. All earlier triage results became stale (the gate enforces this) and were re-run.
