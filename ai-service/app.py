import io
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image
from nudenet import NudeDetector
from transformers import pipeline

app = FastAPI(title="Yehudi Kasher Local Image AI", version="1.0.0")

POLICY_VERSION = "HAREDI_STRICT_V2_LOCAL"
MAX_BYTES = 5 * 1024 * 1024

FEMALE_LABELS = {
    "FACE_FEMALE",
    "FEMALE_GENITALIA_COVERED",
    "FEMALE_BREAST_COVERED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
}
REVEALING_LABELS = {
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_EXPOSED",
    "BELLY_EXPOSED",
    "ARMPITS_EXPOSED",
}

SIGLIP_PROMPTS = [
    "a photograph of a woman",
    "a photograph of a girl",
    "a photograph of a man",
    "a photograph of a boy",
    "a photograph of a person wearing a swimsuit",
    "a photograph of revealing clothing",
    "a photograph with no person",
]

_nudenet: NudeDetector | None = None
_siglip: Any = None


def _token_ok(value: str | None) -> bool:
    expected = os.environ.get("LOCAL_AI_TOKEN", "")
    return bool(expected) and value == expected


def _load_nudenet() -> NudeDetector:
    global _nudenet
    if _nudenet is None:
        model_path = os.environ.get("NUDENET_MODEL_PATH")
        if model_path:
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


def _max_score(items: list[dict], labels: set[str]) -> float:
    best = 0.0
    for item in items:
        if str(item.get("class", "")) in labels:
            try:
                best = max(best, float(item.get("score", 0.0)))
            except (TypeError, ValueError):
                pass
    return best


def _siglip_scores(image: Image.Image) -> dict[str, float]:
    outputs = _load_siglip()(image, candidate_labels=SIGLIP_PROMPTS)
    scores: dict[str, float] = {}
    for item in outputs:
        label = str(item.get("label", ""))
        try:
            scores[label] = float(item.get("score", 0.0))
        except (TypeError, ValueError):
            scores[label] = 0.0
    return scores


def evaluate(nude: list[dict], siglip: dict[str, float]) -> dict:
    female_face = _max_score(nude, {"FACE_FEMALE"})
    female_body = _max_score(nude, FEMALE_LABELS)
    revealing = _max_score(nude, REVEALING_LABELS)

    if female_face >= 0.45 or female_body >= 0.45:
        return {
            "allowed": False,
            "reason": "female_detected",
            "details": {
                "nudenetFemale": max(female_face, female_body),
                "nudenetRevealing": revealing,
            },
        }

    if revealing >= 0.40:
        return {
            "allowed": False,
            "reason": "revealing_content",
            "details": {"nudenetRevealing": revealing},
        }

    woman = max(
        siglip.get("a photograph of a woman", 0.0),
        siglip.get("a photograph of a girl", 0.0),
    )
    man = max(
        siglip.get("a photograph of a man", 0.0),
        siglip.get("a photograph of a boy", 0.0),
    )
    swimsuit = siglip.get("a photograph of a person wearing a swimsuit", 0.0)
    revealing_clothes = siglip.get("a photograph of revealing clothing", 0.0)
    no_person = siglip.get("a photograph with no person", 0.0)

    if swimsuit >= 0.55 or revealing_clothes >= 0.55:
        return {
            "allowed": False,
            "reason": "revealing_clothing",
            "details": {
                "siglipSwimsuit": swimsuit,
                "siglipRevealing": revealing_clothes,
            },
        }

    if woman >= 0.55 and woman >= man:
        return {
            "allowed": False,
            "reason": "female_detected",
            "details": {"siglipFemale": woman, "siglipMale": man},
        }

    # Strict rule: a likely-person image must be confidently male. This keeps
    # uncertain portraits fail-closed for the HAREDI_STRICT profile.
    person_like = max(woman, man, swimsuit, revealing_clothes)
    if person_like >= 0.45 and man < 0.62:
        return {
            "allowed": False,
            "reason": "ambiguous_person",
            "details": {
                "siglipFemale": woman,
                "siglipMale": man,
                "siglipNoPerson": no_person,
            },
        }

    return {
        "allowed": True,
        "reason": "image_safe_haredi_strict",
        "details": {
            "siglipFemale": woman,
            "siglipMale": man,
            "siglipNoPerson": no_person,
            "nudenetRevealing": revealing,
        },
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "policyVersion": POLICY_VERSION,
        "nudenetModel": os.environ.get("NUDENET_MODEL_PATH", "bundled-320n"),
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
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="invalid_image_size")

    try:
        image = Image.open(io.BytesIO(body)).convert("RGB")
        image.verify if False else None
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
