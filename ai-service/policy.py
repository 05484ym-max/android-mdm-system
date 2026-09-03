POLICY_VERSION = "HAREDI_STRICT_V3_PERMISSIVE"

SIGLIP_PROMPTS = [
    "a photograph of a woman",
    "a photograph of a girl",
    "a photograph of a man",
    "a photograph of a boy",
    "a photograph of a person wearing a swimsuit",
    "a photograph of revealing clothing",
    "a photograph with no person",
]


def _bounded(value, default=0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number < 0.0 or number > 1.0:
        return default
    return number


def evaluate(
    nsfw_score: float,
    gender_faces: list[dict],
    siglip: dict[str, float],
) -> dict:
    """HAREDI_STRICT policy.

    The policy is deliberately fail-closed. A lack of an unsafe signal is not
    sufficient to allow an image; it needs affirmative evidence that either no
    person is present or that every detected face is confidently male.
    """
    nsfw = _bounded(nsfw_score)
    if nsfw >= 0.35:
        return {
            "allowed": False,
            "reason": "adult_content",
            "details": {"nsfwScore": nsfw},
        }

    female_faces = []
    uncertain_faces = []
    male_faces = []
    for face in gender_faces or []:
        female = _bounded(face.get("female"))
        male = _bounded(face.get("male"))
        detection = _bounded(face.get("detection"), 1.0)
        if detection < 0.60:
            continue
        if female >= 0.70 and female >= male:
            female_faces.append(female)
        elif male >= 0.82 and male > female:
            male_faces.append(male)
        else:
            uncertain_faces.append(max(female, male))

    if female_faces:
        return {
            "allowed": False,
            "reason": "female_detected",
            "details": {
                "femaleFaceCount": len(female_faces),
                "maxFemaleFace": max(female_faces),
            },
        }

    if uncertain_faces:
        return {
            "allowed": False,
            "reason": "ambiguous_face",
            "details": {
                "ambiguousFaceCount": len(uncertain_faces),
                "maxFaceConfidence": max(uncertain_faces),
            },
        }

    woman = max(
        _bounded(siglip.get("a photograph of a woman")),
        _bounded(siglip.get("a photograph of a girl")),
    )
    man = max(
        _bounded(siglip.get("a photograph of a man")),
        _bounded(siglip.get("a photograph of a boy")),
    )
    swimsuit = _bounded(siglip.get("a photograph of a person wearing a swimsuit"))
    revealing = _bounded(siglip.get("a photograph of revealing clothing"))
    no_person = _bounded(siglip.get("a photograph with no person"))

    if swimsuit >= 0.50 or revealing >= 0.50:
        return {
            "allowed": False,
            "reason": "revealing_clothing",
            "details": {
                "siglipSwimsuit": swimsuit,
                "siglipRevealing": revealing,
            },
        }

    if woman >= 0.50 and woman >= man:
        return {
            "allowed": False,
            "reason": "female_detected",
            "details": {"siglipFemale": woman, "siglipMale": man},
        }

    # A detected face must be affirmatively male. If YuNet saw faces but the
    # gender model did not produce a usable result for all of them, fail closed.
    usable_face_count = len(female_faces) + len(uncertain_faces) + len(male_faces)
    if gender_faces and usable_face_count < len(gender_faces):
        return {
            "allowed": False,
            "reason": "ambiguous_face",
            "details": {
                "detectedFaceCount": len(gender_faces),
                "classifiedFaceCount": usable_face_count,
            },
        }

    if male_faces:
        # Even with confidently male faces, strong whole-image evidence for a
        # woman remains a block. Otherwise a male-only image may pass.
        if woman >= 0.42 and woman > man:
            return {
                "allowed": False,
                "reason": "ambiguous_person",
                "details": {"siglipFemale": woman, "siglipMale": man},
            }
        return {
            "allowed": True,
            "reason": "image_safe_haredi_strict",
            "details": {
                "maleFaceCount": len(male_faces),
                "minMaleFace": min(male_faces),
                "nsfwScore": nsfw,
            },
        }

    person_like = max(woman, man, swimsuit, revealing)
    if person_like >= 0.42 and man < 0.65:
        return {
            "allowed": False,
            "reason": "ambiguous_person",
            "details": {
                "siglipFemale": woman,
                "siglipMale": man,
                "siglipNoPerson": no_person,
            },
        }

    if no_person < 0.58 and man < 0.65:
        return {
            "allowed": False,
            "reason": "ambiguous_image",
            "details": {
                "siglipFemale": woman,
                "siglipMale": man,
                "siglipNoPerson": no_person,
                "nsfwScore": nsfw,
            },
        }

    return {
        "allowed": True,
        "reason": "image_safe_haredi_strict",
        "details": {
            "siglipFemale": woman,
            "siglipMale": man,
            "siglipNoPerson": no_person,
            "nsfwScore": nsfw,
        },
    }
