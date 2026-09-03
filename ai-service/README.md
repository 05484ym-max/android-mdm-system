# Local image AI service

Local inference service for the filtered browser. There is no per-image AI API fee; hosting/compute is still required.

## Reviewed model stack

The production stack intentionally uses permissive licenses suitable for a commercial product and avoids remote custom model code:

- `google/siglip2-base-patch16-512` — zero-shot whole-image classification for woman/girl/man/boy, swimsuit, revealing clothing and no-person signals.
- `viddexa/nsfw-detection-mini` — explicit NSFW image classification.
- OpenCV Zoo YuNet `face_detection_yunet_2023mar.onnx` — face detection. The downloaded model is verified against a pinned SHA-256 before use.
- `dima806/man_woman_face_image_detection` — standard Transformers image-classification model used on detected face crops for `man` / `woman` probabilities.

NudeNet and models that require remote helper code are intentionally not part of this runtime. Production model loading uses `trust_remote_code=False` and Safetensors for the Hugging Face models.

## Pinned model revisions

The service pins reviewed Hugging Face revisions so a future upstream `main` update cannot silently change production inference:

- SigLIP2: `a89f5c5093f902bf39d3cd4d81d2c09867f0724b`
- NSFW mini: `008722e6cd8dff64efa75fb2a8482c80e41434ca`
- Man/Woman classifier: `ecab7935ec1df4243f7832b87df94b4cd1530502`
- YuNet SHA-256: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`

Changing any revision is a reviewed release operation and should be followed by the real-model inference smoke and policy validation before deployment.

## Required environment

AI service:
- `LOCAL_AI_TOKEN=<strong random shared secret>`

Node backend:
- `LOCAL_AI_URL=http(s)://<private-ai-service-host>`
- `LOCAL_AI_TOKEN=<the same shared secret>`

Optional model overrides exist for controlled testing, but production should normally use the pinned defaults:
- `SIGLIP_MODEL`
- `SIGLIP_REVISION`
- `NSFW_MODEL`
- `NSFW_REVISION`
- `GENDER_MODEL`
- `GENDER_REVISION`

## Recommended HAREDI_STRICT production environment

- `AI_MAX_CONCURRENCY=1` initially; increase only after measuring RAM/CPU headroom.
- `LOCAL_AI_TOKEN=<strong random shared secret>`

The Node backend calls `POST /moderate` with raw image bytes and the `X-Local-AI-Token` header. Model/runtime errors, service unavailability, invalid responses and policy-version mismatches are all fail-closed: the image is blocked.

## HAREDI_STRICT decision policy

- NSFW score at/above the strict threshold -> block.
- A detected face classified as woman/female with sufficient confidence -> block.
- A detected face with ambiguous gender -> block.
- SigLIP woman/girl, swimsuit or revealing-clothing evidence -> block.
- A model failure or missing signal that prevents an affirmative safe decision -> block.
- Allow only with affirmative evidence of no person, or confidently male-only face/person evidence with no competing unsafe signal.

No image model is perfect. Thresholds must be calibrated on a representative validation set before claiming production filtering quality. In HAREDI_STRICT, recall on prohibited female/revealing imagery is more important than minimizing false-positive blocks.

## Resource policy and hosting

SigLIP2 is the largest component (roughly 1.5 GB of model weights by itself), so the AI service must run separately from the main Node backend. A 512 MB free web-service instance is not suitable for this stack.

Production starting point:
- CPU inference: use at least 4 GB RAM for the AI service while `AI_MAX_CONCURRENCY=1`.
- Keep the main Node/backend service separate.
- Persistent Hugging Face cache/storage is recommended to avoid downloading multi-GB model assets on every cold build/start.
- Benchmark real peak RSS and inference latency before raising concurrency or lowering the memory tier.

Runtime guards:
- Maximum input body: 5 MiB.
- Maximum decoded image area: 25 million pixels.
- Face detection works on a bounded maximum side and classifies at most 8 faces per image.
- Heavy inference concurrency is bounded to prevent a page with many images from exhausting CPU/RAM.
- Node caches stable moderation results by SHA-256 of the actual image bytes and policy version, so identical images are not repeatedly inferred.

## Verification

- Lightweight CI checks FastAPI/auth/image decoding and policy behavior with model imports stubbed.
- A separate real-model smoke workflow downloads and runs the actual YuNet + ManWoman + NSFW + SigLIP2 stack.
- Stale real-model runs are cancelled when a newer branch revision is pushed.
- The YuNet artifact is checksum-pinned; a changed/corrupted artifact fails closed during model loading.
- Hugging Face model revisions are pinned and remote model code is disabled.
