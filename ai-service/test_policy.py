from policy import evaluate


def test_female_face_blocks():
    result = evaluate(
        [{"class": "FACE_FEMALE", "score": 0.91}],
        {},
    )
    assert result["allowed"] is False
    assert result["reason"] == "female_detected"


def test_revealing_blocks():
    result = evaluate(
        [{"class": "BELLY_EXPOSED", "score": 0.75}],
        {},
    )
    assert result["allowed"] is False
    assert result["reason"] == "revealing_content"


def test_siglip_woman_blocks():
    result = evaluate(
        [],
        {
            "a photograph of a woman": 0.88,
            "a photograph of a man": 0.05,
            "a photograph with no person": 0.08,
        },
    )
    assert result["allowed"] is False
    assert result["reason"] == "female_detected"


def test_confident_male_can_pass():
    result = evaluate(
        [],
        {
            "a photograph of a woman": 0.06,
            "a photograph of a man": 0.86,
            "a photograph of a boy": 0.04,
            "a photograph with no person": 0.03,
        },
    )
    assert result["allowed"] is True


def test_ambiguous_person_blocks():
    result = evaluate(
        [],
        {
            "a photograph of a woman": 0.48,
            "a photograph of a man": 0.42,
            "a photograph with no person": 0.10,
        },
    )
    assert result["allowed"] is False
    assert result["reason"] == "ambiguous_person"
