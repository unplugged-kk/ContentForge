# CannerAI parity — architectural mapping

Status: mapping only. This document names **which ContentForge primitive owns
each CannerAI capability**. It is not an implementation plan and it does not add
a second content model.

The governing rule: a capability is a *layer on a primitive*, never a new
pipeline. If a CannerAI feature cannot be expressed on the primitives below,
that is an architecture decision — not a reason to fork the model.

## The primitives (already implemented)

```
ResearchJob → Story → Opportunity → GenerationJob → Artifact
            → Schedule → Occurrence → Publication → Result
```

- **ResearchJob** owns evidence; completed jobs are immutable.
- **Story** is reusable editorial meaning, referencing evidence by ID.
- **Opportunity** is one (Story × format × channel × angle) candidate.
- **GenerationJob** is a reproducible attempt with a frozen `policy_snapshot`.
- **Artifact** is an immutable revision; readiness is its only mutable axis.
- **Schedule/Occurrence** are intent; **Publication** is the attempt;
  **Result** is the proof.
- **ChannelAdapter** owns every platform mechanic. Core has no channel fields.

## Capability → primitive

| CannerAI capability | Owned by | How it maps |
|---|---|---|
| URL / article ingestion | `SourceProvider` → ResearchJob → Story | A provider registration; no new pipeline. |
| Research synthesis | Story (`insight_body`, `angles`) | The Story is the reusable synthesis; evidence stays on the ResearchJob. |
| One story → many formats | Opportunity (N per Story) | Already real: `POST /api/opportunities` with a different `format`. |
| Chat-to-post | Opportunity (or Story) → GenerationJob → Artifact | Chat produces a Story/Opportunity; generation is unchanged. Needs only an input surface. |
| Voice / style matching | Generation **policy** | `policy_snapshot.params` + `system_prompt` are the voice inputs; frozen per job. No domain change. |
| Templates | Generation **policy** | A template becomes a named, versioned policy (`formatPolicyRef`). Artifact unchanged. |
| Multi-platform formatting | N Opportunities → N GenerationJobs → N Artifacts | Format × channel are the only dimensions; each pair is its own chain. |
| Image generation | Opportunity(format) → GenerationJob → Artifact | New `format` + registered payload schema + (later) a media policy. Visual provider sits behind the model port. |
| Carousel | Opportunity(format) → GenerationJob → Artifact | Same as images: a format with a registered payload schema. |
| Scheduling | Artifact(approved) → Schedule → Occurrence | Implemented. Recurrence expansion is the remaining piece. |
| Publishing | Publication → ChannelAdapter | Implemented for `x_post` / `x_thread`; a new channel is one registration. |
| Analytics | Publication → Result | Implemented (one Result per Publication). Metric mappers are adapter-side. |
| Approval workflow | Artifact readiness | Implemented (`draft → in_review → approved | rejected`), pinned per revision. |
| Repurposing / transforms | New Artifact revision (`supersedes_id`) | A transform is a new revision, never a mutation. |
| Second Brain / Context Vault | **Future context subsystem** | Must feed *generation policy* and research context. It must **not** be bolted onto Story, which stays editorial meaning only. |

## Not yet built (deliberately)

- Non-X channel adapters (LinkedIn, Threads, …) — one registration each.
- Non-X format payload schemas (article, newsletter, carousel, video_script).
- Recurrence expansion (RRULE/cron) — schemas exist; expansion is future work.
- Media/asset model (images, carousels) — needs an asset identity decision.
- Voice/template *content* (policies are structured and frozen today; the
  authoring surfaces and corpora are future work).
- Second Brain context subsystem.
- Cross-publication analytics rollups and the learning loop.

## Reference integrations

Postiz, last30days and Agent-Reach remain **references**. When they land:

```
last30days / Agent-Reach / future providers
        ↓
  SourceProvider
        ↓
   ResearchJob
```

They register as providers. They never create a second research pipeline, a
`channels` table, or a competing content model. No Postiz code is copied or
vendored.
