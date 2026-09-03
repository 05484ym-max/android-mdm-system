# Local image AI service

Free-per-image local inference service for the filtered browser.

Models:
- NudeNet 3.4.2 (bundled 320n by default; set NUDENET_MODEL_PATH to a 640m ONNX file for higher-resolution detection).
- google/siglip2-base-patch16-256 for zero-shot image classification.

Required environment:
- LOCAL_AI_TOKEN: shared secret with the Node backend.

Optional:
- NUDENET_MODEL_PATH=/models/640m.onnx
- SIGLIP_MODEL=google/siglip2-base-patch16-256

The Node backend calls POST /moderate with the raw image bytes and
X-Local-AI-Token. Model errors are always returned as BLOCK decisions.

## Production recommendation

For the strict production profile, mount the NudeNet 640m ONNX model and set:

- `NUDENET_MODEL_PATH=/models/640m.onnx`
- `NUDENET_REQUIRE_640=1`
- `SIGLIP_MODEL=google/siglip2-base-patch16-256`
- `LOCAL_AI_TOKEN=<strong shared secret>`

The Node backend must receive the same `LOCAL_AI_TOKEN` plus `LOCAL_AI_URL`
pointing to this service on a private/internal network. If the service is
unavailable or its policy version does not match, the Node backend blocks the
image instead of falling open.

The bundled NudeNet 320n model is kept only as a development fallback. The
recommended production detector is 640m.
