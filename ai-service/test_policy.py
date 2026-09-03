import unittest

from policy import POLICY_VERSION, evaluate


class HarediStrictPolicyTests(unittest.TestCase):
    def test_policy_version_is_local_v2(self):
        self.assertEqual(POLICY_VERSION, "HAREDI_STRICT_V2_LOCAL")

    def test_female_face_blocks(self):
        result = evaluate(
            [{"class": "FACE_FEMALE", "score": 0.91}],
            {},
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")

    def test_revealing_blocks(self):
        result = evaluate(
            [{"class": "BELLY_EXPOSED", "score": 0.75}],
            {},
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "revealing_content")

    def test_siglip_woman_blocks(self):
        result = evaluate(
            [],
            {
                "a photograph of a woman": 0.88,
                "a photograph of a man": 0.05,
                "a photograph with no person": 0.08,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")

    def test_confident_male_can_pass(self):
        result = evaluate(
            [],
            {
                "a photograph of a woman": 0.06,
                "a photograph of a man": 0.86,
                "a photograph of a boy": 0.04,
                "a photograph with no person": 0.03,
            },
        )
        self.assertTrue(result["allowed"])

    def test_ambiguous_person_blocks(self):
        result = evaluate(
            [],
            {
                "a photograph of a woman": 0.48,
                "a photograph of a man": 0.42,
                "a photograph with no person": 0.10,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "ambiguous_person")

    def test_uncertain_non_person_image_blocks(self):
        result = evaluate(
            [],
            {
                "a photograph of a woman": 0.10,
                "a photograph of a man": 0.12,
                "a photograph with no person": 0.30,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "ambiguous_image")

    def test_confident_no_person_can_pass(self):
        result = evaluate(
            [],
            {
                "a photograph of a woman": 0.04,
                "a photograph of a man": 0.03,
                "a photograph with no person": 0.84,
            },
        )
        self.assertTrue(result["allowed"])

    def test_swimsuit_blocks(self):
        result = evaluate(
            [],
            {
                "a photograph of a person wearing a swimsuit": 0.82,
                "a photograph of a man": 0.12,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "revealing_clothing")


if __name__ == "__main__":
    unittest.main()
