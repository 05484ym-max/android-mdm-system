import unittest

from policy import POLICY_VERSION, evaluate


class HarediStrictPolicyTests(unittest.TestCase):
    def test_policy_version_is_group_safe_v4(self):
        self.assertEqual(POLICY_VERSION, "HAREDI_STRICT_V4_GROUP_SAFE")

    def test_nsfw_blocks(self):
        result = evaluate(0.91, [], {"a photograph with no person": 0.9})
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "adult_content")

    def test_female_face_blocks(self):
        result = evaluate(
            0.02,
            [{"female": 0.93, "male": 0.07, "detection": 0.96}],
            {"a photograph of a man": 0.7},
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")

    def test_mixed_male_and_female_faces_block(self):
        result = evaluate(
            0.02,
            [
                {"female": 0.03, "male": 0.97, "detection": 0.98},
                {"female": 0.96, "male": 0.04, "detection": 0.97},
            ],
            {
                "a photograph of a woman": 0.61,
                "a photograph of a man": 0.74,
                "a photograph with no person": 0.02,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")
        self.assertEqual(result["details"]["femaleFaceCount"], 1)

    def test_visible_male_face_cannot_cancel_siglip_woman_signal(self):
        result = evaluate(
            0.02,
            [{"female": 0.02, "male": 0.98, "detection": 0.98}],
            {
                "a photograph of a woman": 0.57,
                "a photograph of a man": 0.91,
                "a photograph with no person": 0.01,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")

    def test_high_male_score_cannot_cancel_ambiguous_female_signal(self):
        result = evaluate(
            0.02,
            [],
            {
                "a photograph of a woman": 0.46,
                "a photograph of a man": 0.88,
                "a photograph with no person": 0.04,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "ambiguous_person")

    def test_ambiguous_face_blocks(self):
        result = evaluate(
            0.02,
            [{"female": 0.51, "male": 0.49, "detection": 0.96}],
            {"a photograph of a man": 0.8},
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "ambiguous_face")

    def test_siglip_woman_blocks(self):
        result = evaluate(
            0.02,
            [],
            {
                "a photograph of a woman": 0.88,
                "a photograph of a man": 0.05,
                "a photograph with no person": 0.08,
            },
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "female_detected")

    def test_confident_male_face_can_pass_when_female_signal_is_low(self):
        result = evaluate(
            0.02,
            [{"female": 0.03, "male": 0.97, "detection": 0.96}],
            {
                "a photograph of a woman": 0.06,
                "a photograph of a man": 0.86,
                "a photograph with no person": 0.03,
            },
        )
        self.assertTrue(result["allowed"])

    def test_ambiguous_person_blocks(self):
        result = evaluate(
            0.02,
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
            0.02,
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
            0.02,
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
            0.02,
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
