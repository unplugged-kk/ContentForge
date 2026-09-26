# ContentForge — Dogfooding Guide

**This is not a feature document.** It is how to use ContentForge for the next 3–7 days so that
the next engineering decisions come from real use rather than another audit.

**Rule for this period: do not fix things as you find them.** Record first, fix afterwards. One
strange event is not an architecture problem.

---

## The point

We have answered *"does it work?"* many times. What we have not answered is:

> Would I genuinely use this every day instead of doing the work manually?

Only real use answers that. So use it naturally, with real content, and keep notes.

**Do not test every feature.** Testing everything produces a checklist. Using it normally produces
the things that actually matter: where you hesitate, what you stop opening, what you redo by hand.

---

## Start the stack

```sh
docker compose up --build -d      # first run builds the image
docker compose ps                 # wait for app to be "healthy"
```

Open **http://localhost:3000** and register your operator account.

See `LOCAL_DEPLOYMENT_REPORT.md` for logs, restart, stop and (destructive) reset commands.

---

## Suggested shape of the week

| Day | What to do |
|---|---|
| 1 | **Research → Create → Review.** Pick a real topic you care about. Approve or reject honestly. |
| 2 | **One topic, several formats.** Post, thread, article. Schedule at least one. |
| 3 | **Agent → Generate → Review → Publish** (if your publishing credentials are configured). |
| 4 | **Sources + research → create from what you actually found**, not from what it suggests. |
| 5 | **Insights → Learning.** Ask honestly: is anything here telling me something I didn't know? |
| 6+ | **Normal daily use.** Let scheduled work and any automation you enabled run. |

Use real content. Synthetic test content hides exactly the problems you care about — real
articles surface truncation, weak synthesis, and bad formatting.

---

## What to pay attention to

You are not looking for crashes. You are looking for **friction and judgement**:

- Where did you stop and think "what do I do now?"
- Where did you click twice because the first click did not do what you expected?
- What did you ignore completely?
- What did you end up doing by hand anyway?
- Did you trust the output, or did you check it?
- Did any status look cleaner than the truth?
- Did the automation make a decision you disagreed with?
- Did anything feel slower than doing it yourself would have been?

Those answers are worth more than any report produced without you involved.

---

## Recording

Keep one file — `DOGFOODING_NOTES.md` at the repo root is fine — using
`docs/DOGFOODING_REPORT_TEMPLATE.md`. A rough note written in the moment beats a tidy one written
from memory three days later.

Capture screenshots for anything visual, and note the **timestamp** — the stack logs are
correlated by time and that is how a symptom becomes a cause.

---

## What happens with the notes

After the run, they become the input to a single findings-and-fix phase:

- every reported problem reproduced
- genuine defects separated from expected behaviour
- related defects looked for that you did not notice
- root cause fixed rather than the symptom
- a regression test for every confirmed defect
- the real Docker Compose workflow re-run
- the affected journeys re-audited

Then a report of **what actually changed because of real usage**.

The next requirements come from your notes. Not from another audit.
