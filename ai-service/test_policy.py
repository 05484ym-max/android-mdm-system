import unittest

from policy import SIGLIP_PROMPTS, SIGNAL_SCHEMA_VERSION, bounded


class SignalNormalizationTests(unittest.TestCase):
    """policy.py now only normalizes raw model signals - it makes no
    ALLOW/BLOCK decision. The binding HAREDI_STRICT policy lives in
    backend/imageModerator.js; the equivalent decision-logic test cases live
    in backend/test-image-moderator.js and must be kept behaviorally
    identical to these signals' consumer.
    """

    def test_signal_schema_version_is_v1(self):
        self.assertEqual(SIGNAL_SCHEMA_VERSION, "LOCAL_AI_SIGNALS_V1")

    def test_siglip_prompts_are_stable(self):
        self.assertEqual(
            SIGLIP_PROMPTS,
            [
                "a photograph of a woman",
                "a photograph of a girl",
                "a photograph of a man",
                "a photograph of a boy",
                "a photograph of a person wearing a swimsuit",
                "a photograph of revealing clothing",
                "a photograph with no person",
            ],
        )

    def test_bounded_accepts_valid_scores(self):
        self.assertEqual(bounded(0.0), 0.0)
        self.assertEqual(bounded(1.0), 1.0)
        self.assertEqual(bounded(0.42), 0.42)
        self.assertEqual(bounded("0.5"), 0.5)

    def test_bounded_rejects_out_of_range_and_falls_back_to_default(self):
        self.assertEqual(bounded(-0.1), 0.0)
        self.assertEqual(bounded(1.1), 0.0)
        self.assertEqual(bounded(-0.1, default=0.7), 0.7)
        self.assertEqual(bounded(1.1, default=0.7), 0.7)

    def test_bounded_rejects_non_numeric_and_falls_back_to_default(self):
        self.assertEqual(bounded(None), 0.0)
        self.assertEqual(bounded("not-a-number"), 0.0)
        self.assertEqual(bounded(object()), 0.0)
        self.assertEqual(bounded(None, default=1.0), 1.0)


if __name__ == "__main__":
    unittest.main()
