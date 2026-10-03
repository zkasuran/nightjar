# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""The word clock alignment is pure Python and runs without Kokoro installed."""

import unittest

from nightjar.kokoro_voice import align, fill, sentences


class TestAlign(unittest.TestCase):
    def test_punctuation_split_off(self):
        ours = ["The", "moon", "smiled.", "Pim's", "turn."]
        theirs = [
            ("The", 0.1, 0.2),
            ("moon", 0.2, 0.5),
            ("smiled", 0.5, 0.9),
            (".", 0.9, 1.0),
            ("Pim's", 1.0, 1.3),
            ("turn", 1.3, 1.6),
            (".", 1.6, 1.7),
        ]
        self.assertEqual(align(ours, theirs), [(0.1, 0.2), (0.2, 0.5), (0.5, 0.9), (1.0, 1.3), (1.3, 1.6)])

    def test_curly_apostrophe_matches(self):
        self.assertEqual(align(["Pim\u2019s"], [("Pim's", 0.0, 0.4)]), [(0.0, 0.4)])

    def test_unmatched_word_is_interpolated_and_monotonic(self):
        ours = ["slow,", "slow,", "very", "slow."]
        theirs = [("slow", 0.0, 0.3), ("slow", 0.4, 0.7), ("slow", 1.2, 1.5)]
        spans = fill(align(ours, theirs), 0.0, 1.6)
        self.assertEqual(len(spans), 4)
        starts = [s for s, _ in spans]
        self.assertEqual(starts, sorted(starts))
        self.assertTrue(all(e >= s for s, e in spans))

    def test_merged_token_is_split(self):
        spans = align(["sleepy", "now"], [("sleepynow", 0.0, 1.0)])
        self.assertAlmostEqual(spans[0][1], 0.6667, places=3)
        self.assertEqual(spans[1], (spans[0][1], 1.0))

    def test_garbage_never_raises(self):
        self.assertEqual(len(fill(align(["!!", "a"], [("zzz", 0, 1)]), 0, 2)), 2)

    def test_sentences_cover_every_word_once(self):
        text = "Pim walked. The moon said 'hi!'\nThen sleep...\n\nEnd"
        parts = sentences(text)
        self.assertEqual(sum(len(p.split()) for p, _ in parts), len(text.split()))
        self.assertEqual([w for _, w in parts], [0, 2, 6, 8])


if __name__ == "__main__":
    unittest.main()
