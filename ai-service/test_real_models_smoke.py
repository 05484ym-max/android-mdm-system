import io
import unittest

from PIL import Image

# This test intentionally downloads/loads the actual production models.
import app as ai_app
from policy import POLICY_VERSION, SIGLIP_PROMPTS


def neutral_image_bytes() -> bytes:
    image = Image.new("RGB", (512, 512), (238, 238, 238))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=90)
    return out.getvalue()


class RealModelSmokeTests(unittest.TestCase):
    def test_real_local_vision_stack_loads_and_infers(self):
        body = neutral_image_bytes()
        image = ai_app._decode_image(body)

        # YuNet model is downloaded and verified against the pinned SHA-256.
        detector = ai_app._load_face_detector()
        self.assertIsNotNone(detector)
        self.assertIsInstance(ai_app._face_crops(image), list)

        # Gender classifier must expose one recognized female label and one
        # recognized male label. The production parser intentionally supports
        # both Female/Male and Woman/Man naming conventions.
        gender = ai_app._load_gender()
        gender_raw = gender(image)
        gender_labels = {
            str(item.get("label", "")).strip().lower()
            for item in (gender_raw or [])
            if isinstance(item, dict)
        }
        self.assertTrue(
            gender_labels.intersection({"female", "woman"}),
            f"Gender model returned no recognized female label: {gender_labels}",
        )
        self.assertTrue(
            gender_labels.intersection({"male", "man"}),
            f"Gender model returned no recognized male label: {gender_labels}",
        )

        # NSFW model must expose a stable unsafe/nsfw class.
        nsfw = ai_app._load_nsfw()
        nsfw_raw = nsfw(image)
        self.assertTrue(
            any(
                isinstance(item, dict)
                and any(
                    token in str(item.get("label", "")).strip().lower()
                    for token in ("nsfw", "adult", "unsafe")
                )
                for item in (nsfw_raw or [])
            ),
            "NSFW model returned no recognized unsafe label",
        )
        nsfw_score = ai_app._nsfw_score(image)
        self.assertGreaterEqual(nsfw_score, 0.0)
        self.assertLessEqual(nsfw_score, 1.0)

        scores = ai_app._siglip_scores(image)
        self.assertIsInstance(scores, dict)
        self.assertTrue(scores, "SigLIP returned no usable candidate scores")
        self.assertTrue(set(scores).issubset(set(SIGLIP_PROMPTS)))
        for score in scores.values():
            self.assertGreaterEqual(score, 0.0)
            self.assertLessEqual(score, 1.0)

        decision = ai_app._run_models(body, image)
        self.assertIsInstance(decision, dict)
        self.assertIsInstance(decision.get("allowed"), bool)
        self.assertIsInstance(decision.get("reason"), str)
        self.assertTrue(decision.get("reason"))
        self.assertEqual(POLICY_VERSION, "HAREDI_STRICT_V3_PERMISSIVE")


if __name__ == "__main__":
    unittest.main()
