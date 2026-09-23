"""Build-time only: download pinned OPUS-MT models and convert them to CTranslate2.

Runs in the ``mt-models`` Docker builder stage, which has torch/transformers.
The runtime image only receives the converted int8 models and SentencePiece
files; the translation service never downloads anything.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from app.mt_models import MODELS

DOWNLOAD_PATTERNS = ["*.json", "*.spm", "*.txt", "*.md", "pytorch_model.bin", "*.safetensors"]


def build(key: str, output: Path) -> Path:
    from ctranslate2.converters import TransformersConverter
    from huggingface_hub import snapshot_download

    repo, revision = MODELS[key]
    source = Path(snapshot_download(repo, revision=revision, allow_patterns=DOWNLOAD_PATTERNS))
    destination = output / key
    TransformersConverter(str(source)).convert(str(destination), quantization="int8", force=True)
    for name in ("source.spm", "target.spm"):
        shutil.copyfile(source / name, destination / name)
    (destination / "SOURCE.json").write_text(
        json.dumps({"repo": repo, "revision": revision, "quantization": "int8"}, indent=2) + "\n",
        encoding="utf-8",
    )
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/out"))
    parser.add_argument("--only", default="", help="comma-separated model keys (default: all)")
    args = parser.parse_args()
    keys = [key for key in args.only.split(",") if key] or list(MODELS)
    args.output.mkdir(parents=True, exist_ok=True)
    for key in keys:
        destination = build(key, args.output)
        size = sum(path.stat().st_size for path in destination.iterdir()) // 2**20
        print(f"{key}: {MODELS[key][0]}@{MODELS[key][1][:12]} -> {destination} ({size} MiB)", flush=True)


if __name__ == "__main__":
    main()
