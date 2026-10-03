# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Hostile inputs. Model output and hand edited files are both untrusted.

Seeded random fuzzing (no extra dependency) plus one named test per attack in
SECURITY.md.
"""

from __future__ import annotations

import json
import random
import string
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from nightjar import features, guard, llm, sleeplog
from nightjar.bible import Bible
from nightjar.config import Child
from nightjar.limits import MAX_FILE_BYTES, MAX_TEXT_CHARS, MAX_TITLE_CHARS
from nightjar.story import _parse

RNG = random.Random(20261003)
ALPHABET = string.printable + '\u200b\u202e\uff4d\u2019{}[]"\\`é漢🙂\x00'


def junk(n: int) -> str:
    return "".join(RNG.choice(ALPHABET) for _ in range(n))


class TestFuzz(unittest.TestCase):
    def test_guard_never_raises_and_always_returns_a_verdict(self):
        for _ in range(400):
            text = junk(RNG.randint(0, 3000))
            v = guard.check(text, avoid=[junk(5), junk(3)], also_screen=junk(20))
            self.assertIsInstance(v.ok, bool)
            self.assertIsInstance(v.violations, list)
            # ok and violations are never inconsistent
            self.assertEqual(v.ok, not v.violations)

    def test_parse_never_raises_and_bounds_title(self):
        for _ in range(400):
            raw = junk(RNG.randint(0, 2000))
            if RNG.random() < 0.3:
                raw = '{"title": "' + junk(400) + '", "text": "' + junk(200) + '"' + junk(10)
            out = _parse(raw)
            self.assertLessEqual(len(out["title"]), MAX_TITLE_CHARS)
            self.assertIsInstance(out["text"], str)

    def test_extract_json_never_raises(self):
        for _ in range(300):
            llm.extract_json(junk(RNG.randint(0, 1500)))
        # deeply nested JSON must not blow the stack
        self.assertIsNone(llm.extract_json("{" + '"a":{' * 50_000 + "}" * 50_001))

    def test_features_never_raise(self):
        for _ in range(200):
            feats = features.extract(junk(RNG.randint(0, 2000)), 110, 4, True, 2, 19)
            self.assertGreaterEqual(feats.word_count, 0)
            self.assertGreaterEqual(feats.sentence_count, 1)


class TestGuardBypass(unittest.TestCase):
    """Attack: spell a banned word so the matcher misses it."""

    def test_zero_width_space_inside_word(self):
        text = "Mira met a mon\u200bster by the gate. " * 20
        self.assertFalse(guard.check(text).ok)

    def test_fullwidth_letters(self):
        text = "Mira met a \uff4d\uff4f\uff4e\uff53\uff54\uff45\uff52 by the gate. " * 20
        self.assertFalse(guard.check(text).ok)

    def test_uppercase(self):
        self.assertFalse(guard.check("A MONSTER WAITED. " * 30).ok)

    def test_curly_apostrophe_in_meta_talk(self):
        self.assertFalse(guard.check("Here\u2019s a story about a turtle. " * 20).ok)

    def test_avoid_term_with_odd_spacing_and_case(self):
        text = "Then came the Thunder, far away. " * 20
        self.assertFalse(guard.check(text, avoid=["  THUNDER "]).ok)

    def test_oversized_input_is_refused_not_scanned(self):
        v = guard.check("a " * (MAX_TEXT_CHARS))
        self.assertFalse(v.ok)
        self.assertIn("characters", v.violations[0])

    def test_non_string_input(self):
        self.assertFalse(guard.check(None).ok)  # type: ignore[arg-type]


class TestTamperedFiles(unittest.TestCase):
    """Attack: a hand edited or corrupted file takes down bedtime."""

    def test_child_profile_garbage_gives_clear_error(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "child.json"
            for body in ("not json", "[]", '{"name": "", "age": 4}', '{"name": "M", "age": "four"}', '{"name": "M", "age": 99}'):
                p.write_text(body)
                with self.assertRaises(ValueError):
                    Child.load(p)

    def test_child_profile_drops_bad_fields(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "child.json"
            p.write_text(
                json.dumps({"name": "Mira", "age": 4, "avoid": ["thunder", 7, None], "narrator_voice_id": "../../etc", "bedtime_hour": 99})
            )
            c = Child.load(p)
            self.assertEqual(c.avoid, ["thunder"])
            self.assertIsNone(c.narrator_voice_id)
            self.assertEqual(c.bedtime_hour, 19)

    def test_oversized_file_is_refused(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "bible.json"
            p.write_text(" " * (MAX_FILE_BYTES + 1))
            with self.assertRaises(ValueError):
                Bible.load(p)

    def test_bible_with_wrong_types_loads_what_is_valid(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "bible.json"
            p.write_text(json.dumps({"characters": [{"name": "Pim"}, 5, {"name": 3}], "chapters": [{"title": 1, "cast": [1, "Pim"]}, "x"]}))
            b = Bible.load(p)
            self.assertEqual([c.name for c in b.characters], ["Pim"])
            self.assertEqual(b.chapters[0].cast, ["Pim"])
            self.assertEqual(b.chapters[0].title, "")

    def test_sleep_log_with_bad_rows_skips_them(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "log.csv"
            head = ",".join(sleeplog.COLUMNS)
            good = "2026-10-01,ok," + ",".join(["1"] * len(features.FEATURE_COLUMNS)) + ",9"
            bad_num = "2026-10-02,bad," + ",".join(["x"] * len(features.FEATURE_COLUMNS)) + ",9"
            nan = "2026-10-03,nan," + ",".join(["nan"] * len(features.FEATURE_COLUMNS)) + ",9"
            neg = "2026-10-04,neg," + ",".join(["1"] * len(features.FEATURE_COLUMNS)) + ",-5"
            short = "2026-10-05,short"
            p.write_text("\n".join([head, good, bad_num, nan, neg, short]) + "\n")
            rows = sleeplog.labelled(p)
            self.assertEqual([r["title"] for r in rows], ["ok"])


if __name__ == "__main__":
    unittest.main()
