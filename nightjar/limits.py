# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""Every ceiling on untrusted input, in one place.

Model output is untrusted: a small model can loop, emit megabytes or produce
half a JSON object. Files on disk are untrusted too, since a parent edits them
by hand.
"""

MAX_TEXT_CHARS = 20_000  # one story plus title, far above any real chapter
MAX_MODEL_REPLY_BYTES = 256_000  # Ollama response body
MAX_AVOID_TERMS = 64
MAX_TERM_CHARS = 64
MAX_FILE_BYTES = 2_000_000  # child.json, bible.json, bedtime_log.csv
MAX_LOG_ROWS = 5_000  # thirteen years of nightly rows
MAX_BIBLE_CHAPTERS = 5_000
MAX_CHARACTERS = 200
MAX_TITLE_CHARS = 120
