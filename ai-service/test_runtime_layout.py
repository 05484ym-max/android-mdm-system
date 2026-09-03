import ast
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class LocalAiRuntimeLayoutTests(unittest.TestCase):
    def test_docker_image_contains_policy_module(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY app.py policy.py ./", dockerfile)

    def test_required_runtime_helpers_are_defined(self):
        tree = ast.parse((ROOT / "app.py").read_text(encoding="utf-8"))
        function_names = {
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        assigned_names = set()
        for node in tree.body:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name):
                        assigned_names.add(target.id)

        self.assertIn("_siglip_scores", function_names)
        self.assertIn("_decode_image", function_names)
        self.assertIn("MAX_BYTES", assigned_names)
        self.assertIn("MAX_IMAGE_PIXELS", assigned_names)

    def test_siglip_prompt_contract_is_wired(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn("candidate_labels=SIGLIP_PROMPTS", source)
        self.assertIn("siglip_incomplete_result", source)


if __name__ == "__main__":
    unittest.main()
