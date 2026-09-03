POLICY_VERSION = "HAREDI_STRICT_V2_LOCAL"

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


def _max_score(items: list[dict], labels: set[str]) -> float:
    best = 0.0
    for item in items:
        if str(item.get("class", "")) in labels:
            try:
                best = max(best, float(item.get("score", 0.0)))
            except (TypeError, ValueError):
                pass
    return best


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
