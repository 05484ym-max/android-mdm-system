import hmac
import io
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image
from nudenet import NudeDetector
from transformers import pipeline

from policy import POLICY_VERSION, SIGLIP_PROMPTS, evaluate

MAX_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000

app = FastAPI(title="Yehudi Kasher Local Image AI", version="1.0.1")

_nudenet: NudeDetector | None = None
_siglip: Any = None


def _token_ok(value: str | None) -> bool:
    expected = os.environ.get("LOCAL_AI_TOKEN", "")
    supplied = value or ""
    return bool(expected) and hmac.compare_digest(supplied, expected)


def _load_nudenet() -> NudeDetector:
    global _nudenet
    if _nudenet is None:
        model_path = os.environ.get("NUDENET_MODEL_PATH")
        require_640 = os.environ.get("NUDENET_REQUIRE_640", "0") == "1"
        if require_640 and not model_path:
            raise RuntimeError("NUDENET_REQUIRE_640 is enabled but NUDENET_MODEL_PATH is missing")
        if model_path:
            if not os.path.isfile(model_path):
                raise RuntimeError("NUDENET_MODEL_PATH does not exist")
            _nudenet = NudeDetector(model_path=model_path, inference_resolution=640)
        else:
            _nudenet = NudeDetector()
    return _nudenet


def _load_siglip():
    global _siglip
    if _siglip is None:
        model_name = os.environ.get(
            "SIGLIP_MODEL",
            "google/siglip2-base-patch16-256",
        )
        _siglip = pipeline(
            task="zero-shot-image-classification",
            model=model_name,
            device=-1,
        )
    return _siglip


def _siglip_scores(image: Image.Image) -> dict[str, float]:
    """Run the fixed prompt set and return a validated prompt->score map."""
    raw = _load_siglip()(
        image,
        candidate_labels=SIGLIP_PROMPTS,
        # Our labels are already complete natural-language prompts. The
        # Transformers pipeline otherwise wraps them in its default template.
        hypothesis_template="{}",
    )
    if not isinstance(raw, list):
        raise RuntimeError("siglip_invalid_result")

    scores: dict[str, float] = {}
    allowed_prompts = set(SIGLIP_PROMPTS)
    for item in raw:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", ""))
        if label not in allowed_prompts:
            continue
        try:
            score = float(item.get("score", 0.0))
        except (TypeError, ValueError):
            continue
        if 0.0 <= score <= 1.0:
            scores[label] = score

    # A partial/malformed response must never silently turn into an allow.
    if set(scores) != allowed_prompts:
        raise RuntimeError("siglip_incomplete_result")
    return scores


def _decode_image(body: bytes) -> Image.Image:
    if not body or len(body) > MAX_BYTES:
        raise ValueError("invalid_image_size")

    probe = Image.open(io.BytesIO(body))
    width, height = probe.size
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise ValueError("image_dimensions_rejected")
    probe.verify()

    image = Image.open(io.BytesIO(body)).convert("RGB")
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise ValueError("image_dimensions_rejected")
    return image


@app.get("/health")
def health():
    model_path = os.environ.get("NUDENET_MODEL_PATH")
    require_640 = os.environ.get("NUDENET_REQUIRE_640", "0") == "1"
    return {
        "status": "ok",
        "policyVersion": POLICY_VERSION,
        "productionReady": (not require_640) or bool(model_path),
        "nudenetModel": model_path or "bundled-320n",
        "siglipModel": os.environ.get(
            "SIGLIP_MODEL",
            "google/siglip2-base-patch16-256",
        ),
    }


@app.post("/moderate")
async def moderate(
    request: Request,
    x_local_ai_token: str | None = Header(default=None),
):
    if not _token_ok(x_local_ai_token):
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await request.body()
    try:
        image = _decode_image(body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_image") from exc

    try:
        nude = _load_nudenet().detect(body)
        siglip = _siglip_scores(image)
        decision = evaluate(nude, siglip)
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
