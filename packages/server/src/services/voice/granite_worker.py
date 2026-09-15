#!/usr/bin/env python3
"""
Warm IBM Granite Speech subprocess worker for YA local speech recognition.

Loads the model once, then reads JSON requests from stdin and writes
JSON responses to stdout. The Node.js LocalGraniteBackend keeps this
process alive between utterances to avoid per-utterance model load.

Granite Speech is a speech-aware language model, not a CTC/RNNT recognizer:
transcription is a generation request whose chat prompt carries an `<|audio|>`
placeholder, so this worker builds that prompt instead of calling the
Transformers ASR pipeline.

Request line:  {"audio_b64":"<base64>","mime_type":"audio/webm;codecs=opus"}
Response line: {"text":"..."} or {"error":"..."}
Startup line:  {"status":"ready"} (written once after model loads)
"""

import base64
import json
import math
import sys
import tempfile
import traceback
from typing import Any, Optional

from stt_worker_common import (
    TARGET_SAMPLE_RATE,
    decode_mono_16k,
    suffix_for_mime,
    summarize_model_load_error,
    unlink_if_present,
)

DEFAULT_GRANITE_MODEL = "ibm-granite/granite-speech-4.1-2b"

TRANSCRIBE_INSTRUCTION = (
    "<|audio|>transcribe the speech with proper punctuation and capitalization."
)

#: Generated tokens allowed per second of audio, plus a fixed floor/ceiling.
#: Ordinary speech runs near 3.5 tokens/s, so this leaves headroom for fast or
#: dense speech without letting a runaway generation hold the worker open.
TOKENS_PER_AUDIO_SECOND = 8
MIN_NEW_TOKENS_BUDGET = 64
MAX_NEW_TOKENS_BUDGET = 2048


def resolve_device(device_arg: str, torch: Any) -> str:
    normalized = device_arg.strip().lower()
    if normalized in ("", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    return normalized


def missing_dependency_hint(
    model_name: str, message: str, lower: str
) -> Optional[str]:
    missing = next(
        (name for name in ("peft", "torchaudio") if name in lower),
        None,
    )
    if not missing:
        return None
    return (
        f"Model load failed for {model_name}: Granite Speech needs {missing}, "
        "which is not installed in the pixi stt environment. Run `pixi run -e "
        "stt stt-bootstrap-granite` from the YA checkout, then restart YA. "
        f"Underlying error: {message}"
    )


def new_token_budget(sample_count: int) -> int:
    seconds = sample_count / TARGET_SAMPLE_RATE
    budget = MIN_NEW_TOKENS_BUDGET + math.ceil(seconds * TOKENS_PER_AUDIO_SECOND)
    return min(budget, MAX_NEW_TOKENS_BUDGET)


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GRANITE_MODEL
    device_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"

    sys.stderr.write(f"[granite_worker] Loading {model_name} on device={device_arg}...\n")
    sys.stderr.flush()

    try:
        import torch  # type: ignore[import]
        from transformers import (  # type: ignore[import]
            AutoModelForSpeechSeq2Seq,
            AutoProcessor,
        )

        device = resolve_device(device_arg, torch)
        processor = AutoProcessor.from_pretrained(model_name)
        tokenizer = processor.tokenizer
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_name,
            device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32,
        )
        model.eval()
        prompt = tokenizer.apply_chat_template(
            [{"role": "user", "content": TRANSCRIBE_INSTRUCTION}],
            tokenize=False,
            add_generation_prompt=True,
        )
    except Exception as exc:  # noqa: BLE001 - Worker startup errors use the JSON protocol.
        sys.stdout.write(
            json.dumps(
                {
                    "error": summarize_model_load_error(
                        model_name, exc, extra_rules=(missing_dependency_hint,)
                    )
                }
            )
            + "\n"
        )
        sys.stdout.flush()
        sys.exit(1)

    sys.stderr.write("[granite_worker] Model ready\n")
    sys.stderr.flush()
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"error": f"JSON error: {exc}"}) + "\n")
            sys.stdout.flush()
            continue

        try:
            audio_bytes = base64.b64decode(req["audio_b64"])
            suffix = suffix_for_mime(str(req.get("mime_type") or ""))

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
                fh.write(audio_bytes)
                tmpfile = fh.name

            try:
                samples = decode_mono_16k(tmpfile)
            finally:
                unlink_if_present(tmpfile)

            if samples.size == 0:
                sys.stdout.write(json.dumps({"text": ""}) + "\n")
                sys.stdout.flush()
                continue

            wav = torch.from_numpy(samples).unsqueeze(0)
            inputs = processor(prompt, wav, device=device, return_tensors="pt").to(
                device
            )
            with torch.no_grad():
                outputs = model.generate(
                    **inputs,
                    max_new_tokens=new_token_budget(samples.size),
                    do_sample=False,
                    num_beams=1,
                )
            generated = outputs[0, inputs["input_ids"].shape[-1] :]
            text = tokenizer.decode(generated, skip_special_tokens=True).strip()
            sys.stdout.write(json.dumps({"text": text}) + "\n")

        except Exception as exc:  # noqa: BLE001 - Keep the worker alive after a failed request.
            traceback.print_exc(file=sys.stderr)
            sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")

        sys.stdout.flush()


if __name__ == "__main__":
    main()
