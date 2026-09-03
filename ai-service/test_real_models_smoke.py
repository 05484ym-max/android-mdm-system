import io
import unittest

import torch
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
    def test_real_permissive_stack_loads_and_infers(self):
        body = neutral_image_bytes()
        image = ai_app._decode_image(body)

        # YuNet model is downloaded from the reviewed OpenCV Zoo artifact and
        # verified against the pinned SHA-256 before it is instantiated.
        self.assertIsNotNone(ai_app._load_face_detector())
        self.assertIsInstance(ai_app._face_crops(image), list)

        nsfw = ai_app._nsfw_score(image)
        self.assertGreaterEqual(nsfw, 0.0)
        self.assertLessEqual(nsfw, 1.0)

        scores = ai_app._siglip_scores(image)
        self.assertIsInstance(scores, dict)
        self.assertTrue(scores, "SigLIP returned no usable candidate scores")
        self.assertTrue(set(scores).issubset(set(SIGLIP_PROMPTS)))
        for score in scores.values():
            self.assertGreaterEqual(score, 0.0)
            self.assertLessEqual(score, 1.0)

        # Load and execute the actual age/gender model even though the neutral
        # smoke fixture is not a face. This proves model/runtime compatibility;
        # face-specific accuracy is covered later by the validation dataset.
        processor, gender_model = ai_app._load_gender()
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            output = gender_model(**inputs)
        logits = getattr(output, "logits", None)
        self.assertIsNotNone(logits)
        self.assertGreaterEqual(logits.detach().cpu().reshape(-1).numel(), 2)

        decision = ai_app._run_models(body, image)
        self.assertIsInstance(decision, dict)
        self.assertIsInstance(decision.get("allowed"), bool)
        self.assertIsInstance(decision.get("reason"), str)
        self.assertTrue(decision.get("reason"))
        self.assertEqual(POLICY_VERSION, "HAREDI_STRICT_V3_PERMISSIVE")


if __name__ == "__main__":
    unittest.main()
