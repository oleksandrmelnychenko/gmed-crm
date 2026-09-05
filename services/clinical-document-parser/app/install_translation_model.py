"""Build-time/local setup only. The clinical worker never downloads models."""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

MODEL_URL = "https://argos-net.com/v1/translate-en_de-1_3.argosmodel"
MODEL_SHA256 = "6cd847f0c06c9c66013e6b0932e07fd54a6d90894659c02bf6c5247b72fb25b1"
MODEL_PREFIX = "translate-en_de-1_3"


def install_model(data: bytes, destination: Path) -> Path:
    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError("Translation model checksum mismatch")
    root = destination.resolve()
    with ZipFile(BytesIO(data)) as archive:
        for entry in archive.infolist():
            # Only the inference artifacts and their attribution are needed.
            parts = Path(entry.filename).parts
            if len(parts) < 2 or parts[0] != MODEL_PREFIX or parts[1] == "stanza":
                continue
            target = (root / entry.filename).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Invalid model archive path")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
    return root / MODEL_PREFIX


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--destination", type=Path, default=Path("models"))
    args = parser.parse_args()
    if args.archive:
        data = args.archive.read_bytes()
    else:
        with urlopen(MODEL_URL, timeout=120) as response:
            data = response.read(200 * 1024 * 1024)
    path = install_model(data, args.destination)
    print(f"Installed {MODEL_PREFIX}: {path}")


if __name__ == "__main__":
    main()
