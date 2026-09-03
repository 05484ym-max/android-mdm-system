import io
import os
import sys
import types
import unittest
from unittest import mock

# CI deliberately does not install heavyweight Torch/Transformers/NudeNet.
# Stub only those imports; FastAPI/Pillow are real so request parsing, auth and
# image decoding are exercised by the smoke test.
fake_nudenet = types.ModuleType("nudenet")
class FakeNudeDetector:
    def __init__(self, *args, **kwargs):
        pass
    def detect(self, image):
        return []
fake_nudenet.NudeDetector = FakeNudeDetector
sys.modules.setdefault("nudenet", fake_nudenet)

fake_transformers = types.ModuleType("transformers")
def fake_pipeline(*args, **kwargs):
    return lambda image, candidate_labels=None: []
fake_transformers.pipeline = fake_pipeline
sys.modules.setdefault("transformers", fake_transformers)

from fastapi.testclient import TestClient
from PIL import Image

import app as ai_app


def png_bytes():
    out = io.BytesIO()
    Image.new("RGB", (16, 16), (240, 240, 240)).save(out, format="PNG")
    return out.getvalue()


class LocalAiRuntimeSmokeTests(unittest.TestCase):
    def setUp(self):
        self.old_token = os.environ.get("LOCAL_AI_TOKEN")
        os.environ["LOCAL_AI_TOKEN"] = "ci-secret-token"
        self.client = TestClient(ai_app.app)

    def tearDown(self):
        if self.old_token is None:
            os.environ.pop("LOCAL_AI_TOKEN", None)
        else:
            os.environ["LOCAL_AI_TOKEN"] = self.old_token

    def test_health_exposes_policy_version(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["policyVersion"], "HAREDI_STRICT_V2_LOCAL")

    def test_concurrency_env_is_always_bounded(self):
        with mock.patch.dict(os.environ, {"AI_MAX_CONCURRENCY": "abc"}):
            self.assertEqual(ai_app._configured_concurrency(), 1)
        with mock.patch.dict(os.environ, {"AI_MAX_CONCURRENCY": "-5"}):
            self.assertEqual(ai_app._configured_concurrency(), 1)
        with mock.patch.dict(os.environ, {"AI_MAX_CONCURRENCY": "99"}):
            self.assertEqual(ai_app._configured_concurrency(), 4)
        with mock.patch.dict(os.environ, {"AI_MAX_CONCURRENCY": "2"}):
            self.assertEqual(ai_app._configured_concurrency(), 2)

    def test_moderate_requires_shared_token(self):
        response = self.client.post(
            "/moderate",
            content=png_bytes(),
            headers={"Content-Type": "application/octet-stream"},
        )
        self.assertEqual(response.status_code, 401)

    def test_invalid_image_is_rejected_before_models(self):
        response = self.client.post(
            "/moderate",
            content=b"not-an-image",
            headers={
                "Content-Type": "application/octet-stream",
                "X-Local-AI-Token": "ci-secret-token",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_model_block_contract(self):
        with mock.patch.object(
            ai_app,
            "_run_models",
            return_value={
                "allowed": False,
                "reason": "female_detected",
                "details": {"siglipFemale": 0.97},
            },
        ):
            response = self.client.post(
                "/moderate",
                content=png_bytes(),
                headers={
                    "Content-Type": "application/octet-stream",
                    "X-Local-AI-Token": "ci-secret-token",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["allowed"])
        self.assertEqual(body["reason"], "female_detected")
        self.assertEqual(body["policyVersion"], "HAREDI_STRICT_V2_LOCAL")

    def test_model_exception_fails_closed(self):
        with mock.patch.object(ai_app, "_run_models", side_effect=RuntimeError("boom")):
            response = self.client.post(
                "/moderate",
                content=png_bytes(),
                headers={
                    "Content-Type": "application/octet-stream",
                    "X-Local-AI-Token": "ci-secret-token",
                },
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["allowed"])
        self.assertEqual(body["reason"], "local_ai_error")


if __name__ == "__main__":
    unittest.main()
