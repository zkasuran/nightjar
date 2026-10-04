# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Tests that run with no model, no network and no API keys."""

from __future__ import annotations

import csv
import json
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from nightjar import book, features, guard, sleeplog, tune
from nightjar.bible import Bible, Chapter, Character
from nightjar.story import Knobs, _parse


class TestGuard(unittest.TestCase):
    def test_accepts_a_calm_story(self):
        text = (
            "Mira put on her red boots. The turtle walked slowly beside her. "
            "They counted the soft things in the garden. The moon waited behind "
            "the chimney. Everyone was warm and already sleepy. "
        ) * 4
        self.assertTrue(guard.check(text).ok)

    def test_blocks_banned_word(self):
        text = "Mira met a monster in the garden. " * 30
        verdict = guard.check(text)
        self.assertFalse(verdict.ok)
        self.assertTrue(any("monster" in v for v in verdict.violations))

    def test_blocks_personal_avoid_list(self):
        text = "Mira heard thunder outside the window. " * 30
        verdict = guard.check(text, avoid=["thunder"])
        self.assertFalse(verdict.ok)
        self.assertIn("personal avoid-list term: thunder", verdict.violations)

    def test_blocks_model_meta_talk(self):
        text = "Here is a story about a turtle. " * 30
        self.assertFalse(guard.check(text).ok)

    def test_request_screening_softens_not_refuses(self):
        self.assertEqual(guard.screen_request("a dragon that breathes fire", ["thunder"]), ["fire"])
        self.assertEqual(guard.screen_request("Thunder and a MONSTER", ["thunder"]), ["monster", "thunder"])
        self.assertEqual(guard.screen_request("the slow turtle", ["thunder"]), [])
        self.assertEqual(guard.screen_request(None), [])  # type: ignore[arg-type]

    def test_prompt_asks_to_soften_scary_request(self):
        from nightjar.bible import Bible
        from nightjar.config import Child
        from nightjar.story import Knobs, _build_prompt

        child = Child(name="Mira", age=4, reading_grade=1.0, avoid=["thunder"])
        prompt = _build_prompt(child, Knobs(), Bible([], []), "a monster in the thunder")
        self.assertIn("Nothing frightening at all", prompt)
        # The scary words never reach the model, not even as "do not say X".
        self.assertNotIn("monster", prompt.lower())
        self.assertNotIn("thunder", prompt.lower())
        self.assertNotIn("Nothing frightening", _build_prompt(child, Knobs(), Bible([], []), "the slow turtle"))

    def test_horror_request_becomes_a_gentle_story(self):
        # Regression: "horror" failed every draft because the word was quoted
        # back to the model in the prompt and in the retry feedback.
        text, found = guard.gentle_request("horror", [])
        self.assertEqual(found, ["horror"])
        self.assertNotIn("horror", text)
        self.assertIn("kind friend", text)
        text, _ = guard.gentle_request("a scary ghost story with a monster", [])
        self.assertTrue(guard.check(text * 12, min_words=0).ok, text)
        self.assertIn("glowy friend", text)
        self.assertEqual(guard.gentle_request("Pim and the Thunder", ["thunder"])[0], "pim and the something cosy")
        self.assertEqual(guard.gentle_request("the slow turtle", []), ("the slow turtle", []))

    def test_retry_feedback_never_quotes_the_banned_word(self):
        import nightjar.story as st
        from nightjar.bible import Bible
        from nightjar.config import Child
        from nightjar.llm import Completion

        prompts = []
        replies = iter(
            ['{"title":"T","text":"' + "A monster waited. " * 30 + '"}', '{"title":"T","text":"' + "Pim walked slowly home. " * 20 + '"}']
        )

        def fake(prompt, **kw):
            prompts.append(prompt)
            return Completion(next(replies), 0, 0, 1)

        orig = st.llm.generate
        st.llm.generate = fake
        try:
            story = st.tonight(Child(name="Mira", age=4, reading_grade=1.0), st.Knobs(target_words=80), Bible([], []), request="horror")
        finally:
            st.llm.generate = orig
        self.assertEqual(story.attempts, 2)
        self.assertNotIn("monster", prompts[1].lower())
        self.assertNotIn("horror", prompts[0].lower() + prompts[1].lower())

    def test_request_leads_and_history_shrinks(self):
        from nightjar.bible import Bible, Chapter
        from nightjar.config import Child
        from nightjar.story import Knobs, _build_prompt

        b = Bible(
            [],
            [Chapter("2026-10-01", "Old", "Pim walked far", ["Pim"], "a leaf"), Chapter("2026-10-02", "Older", "Pim slept", ["Pim"], "")],
        )
        child = Child(name="Mira", age=4, reading_grade=1.0)
        with_req = _build_prompt(child, Knobs(cast=[]), b, "a sleepy train")
        self.assertIn("The story is about: a sleepy train", with_req)
        self.assertIn("Last night: Pim slept", with_req)
        self.assertNotIn("WHAT HAPPENED ON EARLIER NIGHTS", with_req)
        self.assertIn("WHAT HAPPENED ON EARLIER NIGHTS", _build_prompt(child, Knobs(cast=["Pim"]), b, ""))

    def test_blocks_prompt_field_read_aloud(self):
        # Regression from the recorded series (night 8 passed at record time).
        text = "Pim gently touches it. It feels smooth as silk. " * 10 + "Open thread:  Maybe tomorrow the moon will show Pim a rainbow."
        self.assertIn("model meta-talk: open thread:", guard.check(text).violations)

    def test_blocks_narrator_addressing_the_child(self):
        # Regression from the in-browser 270M run.
        text = (
            "Hello, Mira! It's bedtime, and I'm thrilled to be here to read you. Tonight, I'm going to tell you a story about a little turtle friend. "
            * 3
        )
        self.assertFalse(guard.check(text).ok)

    def test_blocks_raw_json_scaffolding(self):
        # Regression: gemma3:1b emitted a fenced JSON block whose body leaked
        # into the story text. Reading that aloud is not acceptable.
        text = '{"title": "The Moon", "text": "Pim walked slowly. ' + "word " * 80 + '"}'
        verdict = guard.check(text)
        self.assertFalse(verdict.ok)
        self.assertTrue(any("scaffolding" in v for v in verdict.violations))

    def test_length_bounds(self):
        self.assertFalse(guard.check("Too short.").ok)
        self.assertFalse(guard.check("word " * 1000, max_words=500).ok)

    def test_substring_is_not_a_match(self):
        # "fire" is banned; "fireflies" must not trip it.
        text = "The fireflies blinked softly over the quiet grass. " * 20
        self.assertTrue(guard.check(text).ok)

    def test_redact_hides_blocked_terms(self):
        self.assertNotIn("monster", guard.redact("a monster").lower())

    def test_title_is_screened_but_not_counted(self):
        body = "Pim walked slowly in the quiet garden. " * 10
        # Avoid-listed word in the title must still fail.
        verdict = guard.check(body, avoid=["thunder"], also_screen="Thunder and the Moon")
        self.assertFalse(verdict.ok)
        self.assertIn("personal avoid-list term: thunder", verdict.violations)
        # A long title must not push a short story over the length bound.
        padded = guard.check("word " * 65, max_words=70, also_screen="a very long title " * 5)
        self.assertTrue(padded.ok, padded.violations)


class TestFeatures(unittest.TestCase):
    def test_syllables(self):
        self.assertEqual(features.count_syllables("moon"), 1)
        self.assertEqual(features.count_syllables("turtle"), 2)
        self.assertEqual(features.count_syllables("beautiful"), 3)

    def test_grade_is_low_for_simple_text(self):
        simple = "The cat sat. The dog ran. The sun is up."
        hard = "Notwithstanding the meteorological circumstances, the expedition proceeded inexorably toward its predetermined destination."
        self.assertLess(features.flesch_kincaid_grade(simple), features.flesch_kincaid_grade(hard))

    def test_extract_row_shape(self):
        feats = features.extract("One two three. Four five six.", 110, 4, True, 2, 19)
        row = feats.as_row()
        for col in features.FEATURE_COLUMNS:
            self.assertIn(col, row)
        self.assertEqual(row["word_count"], 6)


class TestBible(unittest.TestCase):
    def test_roundtrip_and_recall(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "bible.json"
            b = Bible([Character("Pim the Turtle", "slow")], [])
            b.add_chapter(Chapter("2026-10-01", "Boots", "Mira found her red boots", ["Pim the Turtle"], "one boot missing"))
            b.add_chapter(Chapter("2026-10-02", "Moon", "The moon waited behind the chimney", ["The Moon"], ""))
            b.save(path)

            loaded = Bible.load(path)
            self.assertEqual(len(loaded.chapters), 2)
            # New character auto-registered from chapter cast.
            self.assertIsNotNone(loaded.character("The Moon"))
            recalled = loaded.recall("red boots", k=2)
            self.assertTrue(any("Boots" == c.title for c in recalled))

    def test_context_block_mentions_unresolved_thread(self):
        b = Bible([], [])
        b.add_chapter(Chapter("2026-10-01", "Boots", "found boots", ["Pim"], "one boot missing"))
        self.assertIn("one boot missing", b.context_block("boots"))


class TestSleepLog(unittest.TestCase):
    def test_append_then_label(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "log.csv"
            feats = features.extract("One two three. Four five.", 110, 4, True, 2, 19)
            sleeplog.append("2026-10-03", "Chapter", feats, path=path)
            self.assertEqual(len(sleeplog.read(path)), 1)
            self.assertEqual(sleeplog.labelled(path), [])

            self.assertTrue(sleeplog.record_asleep(12, path=path))
            rows = sleeplog.labelled(path)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["minutes_to_asleep"], 12.0)

    def test_header_matches_feature_columns(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "log.csv"
            feats = features.extract("One two. Three four.", 110, 4, True, 2, 19)
            sleeplog.append("2026-10-03", "C", feats, path=path)
            with path.open() as fh:
                header = next(csv.reader(fh))
            self.assertEqual(header, sleeplog.COLUMNS)


class TestTuner(unittest.TestCase):
    """The tuner must produce a sane recommendation from the seeded log."""

    def test_knn_fallback_prefers_short_slow_calm(self):
        history = tune._history()
        self.assertGreaterEqual(len(history), 5, "seeded data/bedtime_log.csv missing")
        rec = tune.recommend(prefer="knn")
        self.assertEqual(rec.backend, "knn-fallback")
        # Seeded data encodes: shorter + slower + calmer = asleep faster.
        self.assertLessEqual(rec.knobs.target_words, 300)
        self.assertLessEqual(rec.knobs.pace_wpm, 110)
        self.assertGreaterEqual(rec.knobs.calm_level, 4)
        self.assertLess(rec.predicted_minutes, rec.baseline_minutes)

    def test_candidate_grid_covers_all_feature_columns(self):
        rows = tune._candidate_rows(tune._history(), cast_size=2)
        self.assertEqual(len(rows), 4 * 3 * 3 * 2)
        for col in features.FEATURE_COLUMNS:
            self.assertIn(col, rows[0])


class TestStoryParsing(unittest.TestCase):
    def test_parses_clean_json(self):
        raw = '{"title":"Boots","text":"Mira walked.","summary":"walk","cast":["Pim"],"open_thread":"x"}'
        parsed = _parse(raw)
        self.assertEqual(parsed["title"], "Boots")
        self.assertEqual(parsed["cast"], ["Pim"])

    def test_recovers_from_prose_reply(self):
        raw = "The Quiet Garden\nMira walked slowly. The turtle followed."
        parsed = _parse(raw)
        self.assertEqual(parsed["title"], "The Quiet Garden")
        self.assertIn("Mira walked", parsed["text"])

    def test_title_brackets_and_quotes_are_removed(self):
        # Observed from gemma3:1b in the recorded series.
        self.assertEqual(_parse('{"title": "[Mira\'s Sleepy Night]", "text": "x"}')["title"], "Mira's Sleepy Night")
        self.assertEqual(_parse('{"title": "\\"Snow\\"", "text": "x"}')["title"], "Snow")
        self.assertEqual(_parse('{"title": "[]", "text": "x"}')["title"], "Tonight's Chapter")

    def test_strips_code_fences(self):
        raw = '```json\n{"title":"Boots","text":"Mira walked."}\n```'
        parsed = _parse(raw)
        self.assertEqual(parsed["title"], "Boots")
        self.assertEqual(parsed["text"], "Mira walked.")

    def test_repairs_broken_escaping(self):
        # The exact shape gemma3:1b produced in testing: valid up to `text`,
        # then escaped quotes that json.loads rejects.
        raw = (
            '```json\n{"title": "The Moon and Pim", "text": "The Moon was quiet '
            'tonight. Pim crawled slow.", \\"summary\\": "Tomorrow the Moon '
            'shines brighter.\\""\n```'
        )
        parsed = _parse(raw)
        self.assertEqual(parsed["title"], "The Moon and Pim")
        self.assertIn("Pim crawled slow", parsed["text"])
        self.assertNotIn('"text"', parsed["text"])
        self.assertTrue(guard.check(parsed["text"], min_words=0).ok)

    def test_knob_description(self):
        self.assertIn("calm=4/5", Knobs().describe())


class TestBook(unittest.TestCase):
    def test_build_raises_when_no_stories_exist(self):
        with TemporaryDirectory() as tmp:
            original = book.OUT_DIR
            book.OUT_DIR = Path(tmp)
            try:
                with self.assertRaises(RuntimeError):
                    book.build("Mira")
            finally:
                book.OUT_DIR = original

    def test_build_renders_chapters(self):
        with TemporaryDirectory() as tmp:
            original = book.OUT_DIR
            book.OUT_DIR = Path(tmp)
            stories = Path(tmp) / "stories"
            stories.mkdir()
            (stories / "a.json").write_text(
                json.dumps(
                    {
                        "title": "The Quiet Garden",
                        "text": "Mira walked slowly.\nThe turtle followed.",
                        "night": date.today().isoformat(),
                    }
                )
            )
            try:
                html_path, _ = book.build("Mira")
                rendered = html_path.read_text()
                self.assertIn("The Quiet Garden", rendered)
                self.assertIn("Mira&#x27;s Book of Nights", rendered)
                self.assertIn("page-break-before", rendered)
            finally:
                book.OUT_DIR = original


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TestLongStory(unittest.TestCase):
    def test_continuation_prompts_end_only_at_the_last_part(self):
        from nightjar.config import Child
        from nightjar.story import Knobs, _continue_prompt

        child = Child(name="Mira", age=4, reading_grade=1.0)
        mid = _continue_prompt(child, Knobs(), "a sleepy train", "The train left.\nIt was dark.", 2, 3)
        end = _continue_prompt(child, Knobs(), "a sleepy train", "The train left.", 3, 3)
        self.assertIn("Do not end the story yet", mid)
        self.assertIn("part 2 of 3", mid)
        self.assertIn("It was dark.", mid)
        self.assertIn("drift off", end)
        long_so_far = "Sparkle the dragon napped. He was blue. He met Pim. Pim had boots. They walked far."
        names = _continue_prompt(child, Knobs(), "a dragon", long_so_far, 2, 3)
        self.assertIn("Sparkle the dragon napped.", names)
        self.assertIn("Keep every name exactly the same", names)
        self.assertNotIn("JSON only", names)
        self.assertNotIn("Do not end", end)

    def test_prose_continuation_keeps_its_first_line(self):
        from nightjar.story import _parse

        p = _parse("The train rolled on.\nIt hummed softly.")
        self.assertTrue(p["_prose_title"])
        self.assertEqual(f"{p['title']}\n{p['text']}", "The train rolled on.\nIt hummed softly.")


class TestLongStoryGuards(unittest.TestCase):
    def test_trailing_backslashes_are_removed(self):
        import json

        from nightjar.story import _parse

        raw = json.dumps({"title": "T", "text": "The sun was fading. \\\\\nThe tracks were blue.\\\\"})
        out = _parse(raw)["text"]
        self.assertNotIn("\\", out)
        self.assertIn("The tracks were blue.", out)

    def test_repeated_sentence_is_detected(self):
        from nightjar.story import _sentences

        a = "The train slowed down a bit, and it started to turn. It hummed."
        self.assertTrue(_sentences(a) & _sentences("The train slowed down a bit, and it started to turn."))
        self.assertFalse(_sentences("It hummed.") & _sentences(a))  # under five words is not a repeat

    def test_middle_parts_are_told_not_to_end(self):
        from nightjar.story import SYSTEM, SYSTEM_MIDDLE

        self.assertIn("Never end it", SYSTEM_MIDDLE)
        self.assertNotIn("already sleepy", SYSTEM_MIDDLE)
        self.assertIn("already sleepy", SYSTEM)


class TestInstructionEcho(unittest.TestCase):
    def test_echoed_instructions_are_refused(self):
        body = "Pim walked slowly in the quiet garden. " * 10
        self.assertFalse(guard.check(body + "Everyone gets cosy, safe and falls sleep.").ok)
        self.assertFalse(guard.check(body + "This was part 2 of 3.").ok)
