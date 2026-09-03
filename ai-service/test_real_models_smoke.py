import io
import os
import unittest

from PIL import Image

# Import the real service modules. This test is intentionally separate from the
# lightweight runtime smoke because it downloads/loads the actual AI models.
import app as ai_app
from policy import POLICY_VERSION, SIGLIP_PROMPTS


def neutral_image_bytes() -> bytes:
    image = Image.new("RGB", (512, 512), (238, 238, 238))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=90)
    return out.getvalue()


class RealModelSmokeTests(unittest.TestCase):
    def test_real_nudenet_and_siglip_load_and_infer(self):
        body = neutral_image_bytes()
        image = ai_app._decode_image(body)

        detector = ai_app._load_nudenet()
        nude = detector.detect(body)
        self.assertIsInstance(nude, list)

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
        self.assertEqual(POLICY_VERSION, "HAREDI_STRICT_V2_LOCAL")


if __name__ == "__main__":
    unittest.main()
