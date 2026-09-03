# Local image AI service

Local inference service for the filtered browser. There is no per-image AI API fee; hosting/compute is still required.

## Reviewed model stack

The production stack intentionally uses permissive licenses suitable for a commercial product:

- `google/siglip2-base-patch16-512` — zero-shot whole-image classification for woman/girl/man/boy, swimsuit, revealing clothing and no-person signals.
- `viddexa/nsfw-detection-mini` — explicit NSFW image classification.
- OpenCV Zoo YuNet `face_detection_yunet_2023mar.onnx` — face detection. The downloaded model is verified against a pinned SHA-256 before use.
- `abhilash88/age-gender-prediction` — gender probability on detected face crops.

NudeNet is intentionally not part of this runtime because the project/package licensing signals are inconsistent across upstream distribution surfaces. Keeping it out avoids that ambiguity.

SigLIP2 is the largest component, so this service should run separately from the main Node backend with persistent Hugging Face model cache/storage when possible.

## Required environment

AI service:
- `LOCAL_AI_TOKEN=<strong random shared secret>`

Node backend:
- `LOCAL_AI_URL=http(s)://<private-ai-service-host>`
- `LOCAL_AI_TOKEN=<the same shared secret>`

## Recommended HAREDI_STRICT production environment

- `SIGLIP_MODEL=google/siglip2-base-patch16-512`
- `NSFW_MODEL=viddexa/nsfw-detection-mini`
- `GENDER_MODEL=abhilash88/age-gender-prediction`
- `AI_MAX_CONCURRENCY=1` initially; increase only after measuring RAM/CPU headroom.
- `LOCAL_AI_TOKEN=<strong random shared secret>`

The Node backend calls `POST /moderate` with raw image bytes and the `X-Local-AI-Token` header. Model/runtime errors, service unavailability, invalid responses and policy-version mismatches are all fail-closed: the image is blocked.

## HAREDI_STRICT decision policy

- NSFW score at/above the strict threshold -> block.
- A detected face classified female with sufficient confidence -> block.
- A detected face with ambiguous gender -> block.
- SigLIP woman/girl, swimsuit or revealing-clothing evidence -> block.
- A model failure or missing signal that prevents an affirmative safe decision -> block.
- Allow only with affirmative evidence of no person, or confidently male-only face/person evidence with no competing unsafe signal.

No image model is perfect. Thresholds must be calibrated on a representative validation set before claiming production filtering quality.

## Resource policy

- Maximum input body: 5 MiB.
- Maximum decoded image area: 25 million pixels.
- Face detection works on a bounded maximum side and classifies at most 8 faces per image.
- Heavy inference concurrency is bounded to prevent a page with many images from exhausting CPU/RAM.
- Node caches stable moderation results by SHA-256 of the actual image bytes and policy version, so identical images are not repeatedly inferred.

## Verification

- Lightweight CI checks FastAPI/auth/image decoding and policy behavior with model imports stubbed.
- A separate real-model smoke workflow downloads and runs the actual model stack. It is intentionally not part of every normal commit because model downloads are large.
- The YuNet artifact is checksum-pinned; a changed/corrupted artifact fails closed during model loading.
