import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


class LocalAiServiceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_source = (ROOT / "app.py").read_text(encoding="utf-8")
        cls.app_tree = ast.parse(cls.app_source)
        cls.dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        cls.requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")

    def _top_level_names(self):
        names = set()
        for node in self.app_tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                names.add(node.name)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        names.add(target.id)
        return names

    def test_required_runtime_symbols_exist(self):
        names = self._top_level_names()
        for required in {
            "MAX_BYTES",
            "MAX_IMAGE_PIXELS",
            "DEFAULT_SIGLIP_MODEL",
            "DEFAULT_SIGLIP_REVISION",
            "DEFAULT_NSFW_MODEL",
            "DEFAULT_NSFW_REVISION",
            "DEFAULT_GENDER_MODEL",
            "DEFAULT_GENDER_REVISION",
            "YUNET_SHA256",
            "_siglip_scores",
            "_nsfw_score",
            "_gender_faces",
            "_verified_yunet_path",
            "_decode_image",
            "_run_models",
            "moderate",
        }:
            self.assertIn(required, names)

    def test_models_are_the_reviewed_permissive_stack(self):
        self.assertIn(
            'DEFAULT_SIGLIP_MODEL = "google/siglip2-base-patch16-512"',
            self.app_source,
        )
        self.assertIn(
            'DEFAULT_NSFW_MODEL = "viddexa/nsfw-detection-mini"',
            self.app_source,
        )
        self.assertIn(
            'DEFAULT_GENDER_MODEL = "dima806/man_woman_face_image_detection"',
            self.app_source,
        )
        self.assertIn('YUNET_REPO = "opencv/opencv_zoo"', self.app_source)
        self.assertNotIn("nudenet", self.requirements.lower())
        self.assertNotIn("NudeDetector", self.app_source)

    def test_huggingface_models_are_revision_pinned_and_remote_code_disabled(self):
        self.assertIn(
            'DEFAULT_SIGLIP_REVISION = "a89f5c5093f902bf39d3cd4d81d2c09867f0724b"',
            self.app_source,
        )
        self.assertIn(
            'DEFAULT_NSFW_REVISION = "008722e6cd8dff64efa75fb2a8482c80e41434ca"',
            self.app_source,
        )
        self.assertIn(
            'DEFAULT_GENDER_REVISION = "ecab7935ec1df4243f7832b87df94b4cd1530502"',
            self.app_source,
        )
        self.assertGreaterEqual(self.app_source.count("trust_remote_code=False"), 3)
        self.assertGreaterEqual(self.app_source.count('model_kwargs={"use_safetensors": True}'), 3)
        self.assertNotIn("trust_remote_code=True", self.app_source)

    def test_gender_parser_accepts_reviewed_model_labels(self):
        self.assertIn('{"female", "woman"}', self.app_source)
        self.assertIn('{"male", "man"}', self.app_source)
        self.assertIn("gender_model_missing_labels", self.app_source)

    def test_yunet_download_is_checksum_pinned(self):
        self.assertIn("hashlib.sha256", self.app_source)
        self.assertIn("yunet_checksum_mismatch", self.app_source)
        self.assertIn(
            'YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"',
            self.app_source,
        )

    def test_inference_is_bounded_and_fail_closed(self):
        self.assertIn("BoundedSemaphore", self.app_source)
        self.assertIn('"status": "error"', self.app_source)
        self.assertIn('"status": "warming"', self.app_source)
        self.assertIn('"status": "unavailable"', self.app_source)

    def test_service_makes_no_allow_block_decision(self):
        # The service is provider/inference-only: no ALLOW/BLOCK judgment,
        # no HAREDI_STRICT thresholds. The binding policy lives in Node
        # (backend/imageModerator.js), not here.
        self.assertNotIn('"allowed"', self.app_source)
        self.assertNotIn("HAREDI_STRICT", self.app_source)
        self.assertNotIn("evaluate", self.app_source)

    def test_container_copies_policy_and_runs_non_root(self):
        self.assertIn("COPY --chown=appuser:appuser app.py policy.py ./", self.dockerfile)
        self.assertIn("USER appuser", self.dockerfile)


if __name__ == "__main__":
    unittest.main()
