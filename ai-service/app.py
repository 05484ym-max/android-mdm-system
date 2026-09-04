import hashlib
import hmac
import io
import math
import os
import threading
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request
from huggingface_hub import hf_hub_download
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from transformers import pipeline

from policy import SIGLIP_PROMPTS, SIGNAL_SCHEMA_VERSION, bounded

app = FastAPI(title="Yehudi Kasher Local Image AI", version="4.0.0")

MAX_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_FACE_DETECT_SIDE = 1280
MAX_FACES = 8

DEFAULT_SIGLIP_MODEL = "google/siglip2-base-patch16-512"
DEFAULT_SIGLIP_REVISION = "a89f5c5093f902bf39d3cd4d81d2c09867f0724b"
DEFAULT_NSFW_MODEL = "viddexa/nsfw-detection-mini"
DEFAULT_NSFW_REVISION = "008722e6cd8dff64efa75fb2a8482c80e41434ca"
DEFAULT_GENDER_MODEL = "dima806/man_woman_face_image_detection"
DEFAULT_GENDER_REVISION = "ecab7935ec1df4243f7832b87df94b4cd1530502"
YUNET_REPO = "opencv/opencv_zoo"
YUNET_FILE = "models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def _configured_concurrency() -> int:
    try:
        requested = int(os.environ.get("AI_MAX_CONCURRENCY", "1"))
    except (TypeError, ValueError):
        requested = 1
    return max(1, min(requested, 4))


_siglip: Any = None
_nsfw: Any = None
_gender: Any = None
_face_detector: Any = None
_model_load_lock = threading.Lock()
_face_detector_lock = threading.Lock()
_inference_gate = threading.BoundedSemaphore(_configured_concurrency())
_model_state_lock = threading.Lock()
_model_state = {"status": "cold", "errorType": None}


def _token_ok(value: str | None) -> bool:
    expected = os.environ.get("LOCAL_AI_TOKEN", "")
    supplied = value or ""
    return bool(expected) and hmac.compare_digest(supplied, expected)


def _load_siglip():
    global _siglip
    if _siglip is not None:
        return _siglip
    with _model_load_lock:
        if _siglip is None:
            _siglip = pipeline(
                task="zero-shot-image-classification",
                model=os.environ.get("SIGLIP_MODEL", DEFAULT_SIGLIP_MODEL),
                revision=os.environ.get("SIGLIP_REVISION", DEFAULT_SIGLIP_REVISION),
                device=-1,
                trust_remote_code=False,
                model_kwargs={"use_safetensors": True},
            )
    return _siglip


def _load_nsfw():
    global _nsfw
    if _nsfw is not None:
        return _nsfw
    with _model_load_lock:
        if _nsfw is None:
            _nsfw = pipeline(
                task="image-classification",
                model=os.environ.get("NSFW_MODEL", DEFAULT_NSFW_MODEL),
                revision=os.environ.get("NSFW_REVISION", DEFAULT_NSFW_REVISION),
                device=-1,
                trust_remote_code=False,
                model_kwargs={"use_safetensors": True},
            )
    return _nsfw


def _load_gender():
    global _gender
    if _gender is not None:
        return _gender
    with _model_load_lock:
        if _gender is None:
            _gender = pipeline(
                task="image-classification",
                model=os.environ.get("GENDER_MODEL", DEFAULT_GENDER_MODEL),
                revision=os.environ.get("GENDER_REVISION", DEFAULT_GENDER_REVISION),
                device=-1,
                trust_remote_code=False,
                model_kwargs={"use_safetensors": True},
            )
    return _gender


def _verified_yunet_path() -> str:
    path = hf_hub_download(repo_id=YUNET_REPO, filename=YUNET_FILE)
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != YUNET_SHA256:
        raise RuntimeError("yunet_checksum_mismatch")
    return path


def _load_face_detector():
    global _face_detector
    if _face_detector is not None:
        return _face_detector
    with _model_load_lock:
        if _face_detector is None:
            model_path = _verified_yunet_path()
            _face_detector = cv2.FaceDetectorYN.create(
                model_path,
                "",
                (320, 320),
                0.70,
                0.30,
                200,
            )
    return _face_detector


def _set_model_state(status: str, error_type: str | None = None) -> None:
    with _model_state_lock:
        _model_state["status"] = status
        _model_state["errorType"] = error_type


def _get_model_state() -> dict:
    with _model_state_lock:
        return dict(_model_state)


def _warm_models() -> None:
    """Load and verify every production model without blocking the web server.

    The service binds its port first, but moderation stays fail-closed while
    warming. This avoids making the first browser image pay multi-model cold
    start time or exceed the Node caller's timeout.
    """
    _set_model_state("warming")
    try:
        _load_face_detector()
        _load_gender()
        _load_nsfw()
        _load_siglip()
    except Exception as exc:
        _set_model_state("error", type(exc).__name__)
        return
    _set_model_state("ready")


@app.on_event("startup")
def start_model_warmup() -> None:
    state = _get_model_state()["status"]
    if state != "cold":
        return
    _set_model_state("warming")
    threading.Thread(
        target=_warm_models,
        name="local-ai-model-warmup",
        daemon=True,
    ).start()


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
    if not scores:
        raise RuntimeError("siglip_no_scores")
    return scores


def _nsfw_score(image: Image.Image) -> float:
    raw = _load_nsfw()(image)
    best = None
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "")).strip().lower()
        if not any(token in label for token in ("nsfw", "adult", "unsafe")):
            continue
        try:
            score = float(item.get("score", 0.0))
        except (TypeError, ValueError):
            continue
        if 0.0 <= score <= 1.0:
            best = score if best is None else max(best, score)
    if best is None:
        raise RuntimeError("nsfw_model_missing_unsafe_label")
    return best


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


def _face_crops(image: Image.Image) -> list[tuple[Image.Image, float]]:
    width, height = image.size
    scale = min(1.0, MAX_FACE_DETECT_SIDE / float(max(width, height)))
    if scale < 1.0:
        work = image.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
    else:
        work = image

    rgb = np.asarray(work, dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    detector = _load_face_detector()
    with _face_detector_lock:
        detector.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, faces = detector.detect(bgr)

    if faces is None:
        return []

    results: list[tuple[Image.Image, float]] = []
    for row in faces[:MAX_FACES]:
        x, y, w, h = [float(v) for v in row[:4]]
        detection = float(row[-1])
        if detection < 0.60 or w <= 1 or h <= 1:
            continue
        margin_x = w * 0.18
        margin_y = h * 0.18
        left = max(0, int(math.floor(x - margin_x)))
        top = max(0, int(math.floor(y - margin_y)))
        right = min(work.width, int(math.ceil(x + w + margin_x)))
        bottom = min(work.height, int(math.ceil(y + h + margin_y)))
        if right - left < 10 or bottom - top < 10:
            continue
        results.append((work.crop((left, top, right, bottom)).convert("RGB"), detection))
    return results


def _gender_faces(image: Image.Image) -> list[dict]:
    crops = _face_crops(image)
    if not crops:
        return []

    classifier = _load_gender()
    results: list[dict] = []
    for crop, detection in crops:
        raw = classifier(crop)
        female = None
        male = None
        for item in raw or []:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label", "")).strip().lower()
            try:
                score = float(item.get("score", 0.0))
            except (TypeError, ValueError):
                continue
            if not 0.0 <= score <= 1.0:
                continue
            if label in {"female", "woman"}:
                female = score
            elif label in {"male", "man"}:
                male = score

        if female is None or male is None:
            raise RuntimeError("gender_model_missing_labels")
        total = female + male
        if total <= 0.0:
            raise RuntimeError("gender_model_invalid_scores")
        female /= total
        male /= total
        results.append({
            "female": female,
            "male": male,
            "detection": max(0.0, min(1.0, detection)),
        })
    return results


def _run_models(body: bytes, image: Image.Image) -> dict:
    """Run every model and return raw, bounded, normalized signal scores.

    This deliberately makes no ALLOW/BLOCK judgment. It is the Node caller's
    responsibility to turn these signals into a policy decision.
    """
    del body
    with _inference_gate:
        nsfw = _nsfw_score(image)
        faces = _gender_faces(image)
        siglip = _siglip_scores(image)
        return {
            "nsfwScore": bounded(nsfw),
            "faces": [
                {
                    "female": bounded(face.get("female")),
                    "male": bounded(face.get("male")),
                    "detection": bounded(face.get("detection"), 1.0),
                }
                for face in faces
            ],
            "siglip": {
                label: bounded(score)
                for label, score in siglip.items()
                if label in SIGLIP_PROMPTS
            },
        }


@app.get("/health")
def health():
    state = _get_model_state()
    return {
        "status": state["status"],
        "signalSchemaVersion": SIGNAL_SCHEMA_VERSION,
        "productionReady": state["status"] == "ready",
        "modelErrorType": state["errorType"],
        "models": {
            "siglip": os.environ.get("SIGLIP_MODEL", DEFAULT_SIGLIP_MODEL),
            "siglipRevision": os.environ.get("SIGLIP_REVISION", DEFAULT_SIGLIP_REVISION),
            "nsfw": os.environ.get("NSFW_MODEL", DEFAULT_NSFW_MODEL),
            "nsfwRevision": os.environ.get("NSFW_REVISION", DEFAULT_NSFW_REVISION),
            "gender": os.environ.get("GENDER_MODEL", DEFAULT_GENDER_MODEL),
            "genderRevision": os.environ.get("GENDER_REVISION", DEFAULT_GENDER_REVISION),
            "faceDetector": "opencv/opencv_zoo:YuNet-2023mar",
        },
        "maxImageBytes": MAX_BYTES,
        "maxImagePixels": MAX_IMAGE_PIXELS,
        "maxConcurrency": _configured_concurrency(),
    }


@app.post("/moderate")
async def moderate(
    request: Request,
    x_local_ai_token: str | None = Header(default=None),
):
    if not _token_ok(x_local_ai_token):
        raise HTTPException(status_code=401, detail="unauthorized")

    state = _get_model_state()["status"]
    if state == "warming":
        return {
            "status": "warming",
            "signalSchemaVersion": SIGNAL_SCHEMA_VERSION,
            "source": "local_apache_vision_stack",
        }
    if state == "error":
        return {
            "status": "unavailable",
            "signalSchemaVersion": SIGNAL_SCHEMA_VERSION,
            "source": "local_apache_vision_stack",
        }

    body = await request.body()
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="invalid_image_size")

    try:
        image = _decode_image(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_image") from exc

    try:
        signals = await run_in_threadpool(_run_models, body, image)
    except Exception as exc:
        return {
            "status": "error",
            "signalSchemaVersion": SIGNAL_SCHEMA_VERSION,
            "source": "local_apache_vision_stack",
            "errorType": type(exc).__name__,
        }

    return {
        "status": "ok",
        "signalSchemaVersion": SIGNAL_SCHEMA_VERSION,
        "source": "local_apache_vision_stack",
        "signals": signals,
    }
