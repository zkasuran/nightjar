<!-- SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0 -->
# Voice consent

Nightjar can read stories aloud in a parent's voice. That is the feature that
makes a child's eyes go wide. It is also the feature most capable of being
misused, so it is gated.

## Rules this project follows

1. **No voice is used without the speaker's own consent**, recorded in writing
   before any audio is generated. The speaker is the voice's owner, not the
   person building the software.
2. **The speaker supplies their own sample.** Audio is recorded knowingly, for
   this purpose, by the person being cloned. No scraping of old videos or
   voicemails.
3. **The speaker can revoke at any time**, at which point the voice ID is
   deleted and narration falls back to local TTS or to text.
4. **The child is told whose voice it is.** The story is read "by Dad, with a
   little help from the computer", never passed off as a live reading.
5. **ElevenLabs terms apply**: you must own the voice or hold the owner's
   consent. Professional voice cloning requires their verification step.
   Instant voice cloning still requires consent.

## Consent record template

Keep this signed and out of version control (`consent/` is gitignored).

```
I, ______________________, consent to a synthetic version of my voice being
created from samples I recorded myself on __________ , for the sole purpose of
narrating bedtime stories to ______________________ on a device in our home.

I understand that:
  - the voice model is stored only on the devices listed below;
  - no audio of my voice or of the child is uploaded for training;
  - I may withdraw this consent at any time by telling ______________________,
    after which the voice will be deleted.

Devices: ______________________________________
Signature: ____________________  Date: ________
```

## Fully offline alternative

If consent is not available or you would rather no third-party service touch
the audio at all, install a local voice:

```bash
# Piper or espeak-ng; narrate.py picks either up automatically
pip install piper-tts
```

This is arguably the better open-innovation story anyway: the voice, the model
and the child's data all stay on one machine.
