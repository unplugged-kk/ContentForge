# video-factory.contract.v1

Transport-neutral integration contract between ContentForge and the separate
Video Factory. This is documentation of the ContentForge provider boundary.
It does **not** change the Video Factory repository.

## Payload model

**Bounded textual job contract (Option A).** Scripts, briefs, and storyboards
are written as files in the factory job folder at submit time. They never enter
pg-boss (`visual.run` payload remains `{ visualGenerationId }`). Remote object
storage is not introduced — the current factory only consumes a filesystem
folder.

## Request

```json
{
  "contractVersion": "video-factory.contract.v1",
  "jobId": "cfvg-123",
  "title": "Vertical explainer",
  "format": "9:16",
  "brief": "…",
  "script": "… or null",
  "storyboard": null,
  "voice": { "enabled": false, "id": null },
  "render": { "quality": "high" },
  "durationMs": 1500
}
```

`jobId` is `cfvg-{VisualGeneration.id}`. ContentForge never accepts a job id,
callback URL, output path, or `renderArgs` array from intent/Story/AI text.

Filesystem transport also writes factory-native files the current runner reads:

- `CONTRACT.json` — this versioned document
- `job.json` — `{ title, format, voice, renderArgs: ["--quality", "<allowlisted>"] }`
- `BRIEF.md`, optional `SCRIPT.md`, optional `STORYBOARD.md`

ContentForge does **not** write `index.html` or HyperFrames composition. Missing
composition is reported honestly; it is not fabricated.

## Status (observational)

```json
{
  "contractVersion": "video-factory.contract.v1",
  "jobId": "cfvg-123",
  "state": "queued",
  "observational": true,
  "error": null
}
```

Known states: `accepted | building | queued | voicing | voiced | rendering | done | failed | unknown`.

`manifest.json` and `state/*.json` are observation, not generation truth.

Mapping:

- in-progress states → ContentForge retries the **same** VideoGeneration (not `ready`)
- `done` → import bytes; VideoAsset is created only after validation + `AssetStoragePort.put`
- `failed` → permanent failure of this generation
- `unknown` → preserve identity, reconcile later, do not mint a new job id

`accepted` is not `ready`. `done` is not `VideoAsset persisted`.

## Output

```json
{
  "contractVersion": "video-factory.contract.v1",
  "jobId": "cfvg-123",
  "outputIdentity": "<sha256 of bytes>",
  "mime": "video/mp4",
  "width": 1080,
  "height": 1920,
  "durationMs": 1500,
  "container": "mp4",
  "byteSize": 32
}
```

Bytes are copied into ContentForge `AssetStoragePort` (`local:<sha>`). Factory
absolute paths never become `VideoAsset.storage_key`.

## Provider interactions (transport-neutral)

```
submit(request) → { jobId, state }
getStatus(jobId) → observational status
getOutput(jobId) → bytes + outputIdentity | null
```

Current transport: local/shared filesystem (`VIDEO_FACTORY_ROOT`) matching
`building/ → queue/ → work/ → done|failed` plus `output/` and `state/`.

HTTP submit is **not** implemented: the current factory exposes a dashboard on
`:4300` (`GET /manifest.json`, `POST /pause|/resume|/retry|/cancel`) and has no
versioned job-submission API.
