import hmac
import io
import os
import threading
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from nudenet import NudeDetector
from starlette.concurrency import run_in_threadpool
from transformers import pipeline

from policy import POLICY_VERSION, SIGLIP_PROMPTS, evaluate

app = FastAPI(title="Yehudi Kasher Local Image AI", version="1.0.0")

MAX_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
DEFAULT_SIGLIP_MODEL = "google/siglip2-base-patch16-512"

# Pillow also performs its own decompression-bomb check. Keep the explicit
# width*height check below as a second, deterministic bound.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

_nudenet: NudeDetector | None = None
_siglip: Any = None
_model_load_lock = threading.Lock()
_inference_gate = threading.BoundedSemaphore(
    max(1, min(int(os.environ.get("AI_MAX_CONCURRENCY", "1")), 4))
)


def _token_ok(value: str | None) -> bool:
    expected = os.environ.get("LOCAL_AI_TOKEN", "")
    supplied = value or ""
    return bool(expected) and hmac.compare_digest(supplied, expected)


def _load_nudenet() -> NudeDetector:
    global _nudenet
    if _nudenet is not None:
        return _nudenet

    with _model_load_lock:
        if _nudenet is not None:
            return _nudenet

        model_path = os.environ.get("NUDENET_MODEL_PATH")
        require_640 = os.environ.get("NUDENET_REQUIRE_640", "0") == "1"
        if require_640 and not model_path:
            raise RuntimeError(
                "NUDENET_REQUIRE_640 is enabled but NUDENET_MODEL_PATH is missing"
            )
        if model_path:
            if not os.path.isfile(model_path):
                raise RuntimeError("NUDENET_MODEL_PATH does not exist")
            _nudenet = NudeDetector(
                model_path=model_path,
                inference_resolution=640,
            )
        else:
            _nudenet = NudeDetector()
    return _nudenet


def _load_siglip():
    global _siglip
    if _siglip is not None:
        return _siglip

    with _model_load_lock:
        if _siglip is not None:
            return _siglip

        model_name = os.environ.get("SIGLIP_MODEL", DEFAULT_SIGLIP_MODEL)
        _siglip = pipeline(
            task="zero-shot-image-classification",
            model=model_name,
            device=-1,
        )
    return _siglip


def _siglip_scores(image: Image.Image) -> dict[str, float]:
    raw = _load_siglip()(image, candidate_labels=SIGLIP_PROMPTS)
    scores: dict[str, float] = {}
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", ""))
        if label not in SIGLIP_PROMPTS:
            continue
        try:
            score = float(item.get("score", 0.0))
        except (TypeError, ValueError):
            continue
        if 0.0 <= score <= 1.0:
            scores[label] = max(scores.get(label, 0.0), score)
    return scores


def _decode_image(body: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(body)) as probe:
            width, height = probe.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise ValueError("image_dimensions_rejected")
            probe.verify()
        with Image.open(io.BytesIO(body)) as reopened:
            reopened.load()
            return reopened.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValueError("invalid_image") from exc


def _run_models(body: bytes, image: Image.Image) -> dict:
    # Limit concurrent heavyweight inference. Without this, a page containing
    # many images can exhaust RAM/CPU even though the Node layer coalesces
    # duplicate hashes.
    with _inference_gate:
        nude = _load_nudenet().detect(body)
        siglip = _siglip_scores(image)
        return evaluate(nude, siglip)


@app.get("/health")
def health():
    model_path = os.environ.get("NUDENET_MODEL_PATH")
    require_640 = os.environ.get("NUDENET_REQUIRE_640", "0") == "1"
    return {
        "status": "ok",
        "policyVersion": POLICY_VERSION,
        "productionReady": (not require_640) or bool(model_path),
        "nudenetModel": model_path or "bundled-320n",
        "siglipModel": os.environ.get("SIGLIP_MODEL", DEFAULT_SIGLIP_MODEL),
        "maxImageBytes": MAX_BYTES,
        "maxImagePixels": MAX_IMAGE_PIXELS,
    }


@app.post("/moderate")
async def moderate(
    request: Request,
    x_local_ai_token: str | None = Header(default=None),
):
    if not _token_ok(x_local_ai_token):
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await request.body()
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="invalid_image_size")

    try:
        image = _decode_image(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_image") from exc

    try:
        decision = await run_in_threadpool(_run_models, body, image)
    except Exception as exc:
        # Never let a model/runtime failure become an allow.
        return {
            "allowed": False,
            "reason": "local_ai_error",
            "details": {"errorType": type(exc).__name__},
            "source": "local_siglip2_nudenet",
            "policyVersion": POLICY_VERSION,
        }

    return {
        **decision,
        "source": "local_siglip2_nudenet",
        "policyVersion": POLICY_VERSION,
    }
