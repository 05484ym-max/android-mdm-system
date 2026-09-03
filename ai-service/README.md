# Local image AI service

Local inference service for the filtered browser. There is no per-image AI API fee; hosting/compute is still required.

Models:
- NudeNet 3.4.2 (bundled 320n only as a development fallback; use a 640m ONNX file for the strict production profile).
- `google/siglip2-base-patch16-512` for zero-shot image classification.

The SigLIP2 model is loaded from Hugging Face by Transformers and is relatively large, so this service should run separately from the main Node backend with persistent model cache/storage when possible.

## Required environment

AI service:
- `LOCAL_AI_TOKEN=<strong random shared secret>`

Node backend:
- `LOCAL_AI_URL=http(s)://<private-ai-service-host>`
- `LOCAL_AI_TOKEN=<the same shared secret>`

## Recommended HAREDI_STRICT production environment

- `NUDENET_MODEL_PATH=/models/640m.onnx`
- `NUDENET_REQUIRE_640=1`
- `SIGLIP_MODEL=google/siglip2-base-patch16-512`
- `AI_MAX_CONCURRENCY=1` initially; increase only after measuring RAM/CPU headroom.
- `LOCAL_AI_TOKEN=<strong random shared secret>`

The Node backend calls `POST /moderate` with raw image bytes and the `X-Local-AI-Token` header. Model/runtime errors, service unavailability, invalid responses and policy-version mismatches are all fail-closed: the image is blocked.

## Resource policy

- Maximum input body: 5 MiB.
- Maximum decoded image area: 25 million pixels.
- Heavy inference concurrency is bounded to prevent a page with many images from exhausting CPU/RAM.
- Node caches stable moderation results by SHA-256 of the actual image bytes and policy version, so identical images are not repeatedly inferred.

## Development fallback

If `NUDENET_MODEL_PATH` is omitted, NudeNet's bundled 320n detector is used. Do not treat this fallback as the final strict-production detector. `/health` exposes `productionReady` so deployments can detect a missing required 640m model configuration.
