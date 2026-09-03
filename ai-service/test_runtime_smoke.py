import io
import os
import sys
import types
import unittest
from unittest import mock

# CI deliberately does not install heavyweight model runtimes here. Stub only
# those imports; FastAPI/Pillow are real so request parsing, auth and image
# decoding are still exercised end-to-end.
fake_cv2 = types.ModuleType("cv2")
fake_cv2.COLOR_RGB2BGR = 1
fake_cv2.cvtColor = lambda image, code: image
class FakeFaceDetectorYN:
    @staticmethod
    def create(*args, **kwargs):
        return object()
fake_cv2.FaceDetectorYN = FakeFaceDetectorYN
sys.modules.setdefault("cv2", fake_cv2)

fake_numpy = types.ModuleType("numpy")
fake_numpy.uint8 = int
fake_numpy.asarray = lambda image, dtype=None: image
sys.modules.setdefault("numpy", fake_numpy)

fake_torch = types.ModuleType("torch")
class FakeNoGrad:
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
fake_torch.no_grad = lambda: FakeNoGrad()
sys.modules.setdefault("torch", fake_torch)

fake_hf = types.ModuleType("huggingface_hub")
fake_hf.hf_hub_download = lambda *args, **kwargs: "/tmp/model.onnx"
sys.modules.setdefault("huggingface_hub", fake_hf)

fake_transformers = types.ModuleType("transformers")
def fake_pipeline(*args, **kwargs):
    return lambda image, **call_kwargs: []
class FakeAuto:
    @classmethod
    def from_pretrained(cls, *args, **kwargs):
        return cls()
fake_transformers.pipeline = fake_pipeline
fake_transformers.AutoImageProcessor = FakeAuto
fake_transformers.AutoModel = FakeAuto
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
        ai_app._set_model_state("cold")
        self.client = TestClient(ai_app.app)

    def tearDown(self):
        ai_app._set_model_state("cold")
        if self.old_token is None:
            os.environ.pop("LOCAL_AI_TOKEN", None)
        else:
            os.environ["LOCAL_AI_TOKEN"] = self.old_token

    def test_health_exposes_policy_version_stack_and_readiness(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["policyVersion"], "HAREDI_STRICT_V3_PERMISSIVE")
        self.assertEqual(body["status"], "cold")
        self.assertFalse(body["productionReady"])
        self.assertIn("siglip", body["models"])
        self.assertIn("nsfw", body["models"])
        self.assertIn("gender", body["models"])

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

    def test_warming_state_fails_closed_without_running_models(self):
        ai_app._set_model_state("warming")
        with mock.patch.object(ai_app, "_run_models") as run_models:
            response = self.client.post(
                "/moderate",
                content=png_bytes(),
                headers={
                    "Content-Type": "application/octet-stream",
                    "X-Local-AI-Token": "ci-secret-token",
                },
            )
        run_models.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["allowed"])
        self.assertEqual(body["reason"], "local_ai_warming")

    def test_model_load_error_fails_closed_without_running_models(self):
        ai_app._set_model_state("error", "RuntimeError")
        with mock.patch.object(ai_app, "_run_models") as run_models:
            response = self.client.post(
                "/moderate",
                content=png_bytes(),
                headers={
                    "Content-Type": "application/octet-stream",
                    "X-Local-AI-Token": "ci-secret-token",
                },
            )
        run_models.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["allowed"])
        self.assertEqual(body["reason"], "local_ai_unavailable")

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
        self.assertEqual(body["policyVersion"], "HAREDI_STRICT_V3_PERMISSIVE")
        self.assertEqual(body["source"], "local_apache_vision_stack")

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
        self.assertEqual(body["source"], "local_apache_vision_stack")


if __name__ == "__main__":
    unittest.main()
