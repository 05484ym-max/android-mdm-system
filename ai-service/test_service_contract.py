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
            "_siglip_scores",
            "_decode_image",
            "_run_models",
            "moderate",
        }:
            self.assertIn(required, names)

    def test_default_siglip_is_512_model(self):
        self.assertIn(
            'DEFAULT_SIGLIP_MODEL = "google/siglip2-base-patch16-512"',
            self.app_source,
        )

    def test_inference_is_bounded_and_fail_closed(self):
        self.assertIn("BoundedSemaphore", self.app_source)
        self.assertIn('"allowed": False', self.app_source)
        self.assertIn('"reason": "local_ai_error"', self.app_source)

    def test_container_copies_policy_and_runs_non_root(self):
        self.assertIn("COPY --chown=appuser:appuser app.py policy.py ./", self.dockerfile)
        self.assertIn("USER appuser", self.dockerfile)


if __name__ == "__main__":
    unittest.main()
