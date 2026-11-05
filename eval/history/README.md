# Eval history

Results of earlier evaluation rounds, kept exactly as they were published, so a number quoted
in a post or an older README can still be checked. The current results are in `../results/`.

| Folder | Round | Graders | Note |
|---|---|---|---|
| `r1-2026-11-04/` | r1, tag `eval-r1` (commit ec717ca) | as of r1 | portfolio-qa only (ticket-triage r1 results are still the current ones). Scored with the r1 graders, which had two bugs fixed in r2. |

To see r1 judged by today's graders without changing these files:

```bash
npm run eval:regrade -- eval/history/r1-2026-11-04/results/portfolio-qa@v1.json eval/history/r1-2026-11-04/results/portfolio-qa@v2.json --dry-run
```

Result: both versions 17 of 18 (94.4%), 5 of 5 correct refusals each.
