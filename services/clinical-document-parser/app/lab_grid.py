"""Geometry for ruled laboratory history tables, including empty date cells."""

from __future__ import annotations

from bisect import bisect_right
import re
from statistics import median
import time
from typing import Any


def ruled_history_columns(image: object) -> list[int]:
    """Find repeated vertical rules, excluding ordinary text strokes.

    The last rules must bound at least three equally spaced result columns.
    Two wider metadata columns precede them. No clinic, page size or values
    are hard-coded, and a continuation page need not repeat the date header.
    """
    if not callable(getattr(image, "getpixel", None)):
        return []
    from PIL import ImageChops, ImageDraw, ImageOps

    gray = ImageOps.grayscale(image)
    ink = gray.point(lambda value: 255 if value < 180 else 0)
    gray.close()
    strokes = ink.copy()
    try:
        width, height = ink.size
        length = max(6, round(height * 0.0083))
        for offset in range(1, length):
            shifted = ImageChops.offset(ink, 0, -offset)
            narrowed = ImageChops.darker(strokes, shifted)
            strokes.close()
            shifted.close()
            strokes = narrowed
        ImageDraw.Draw(strokes).rectangle((0, height - length, width, height), fill=0)
        groups: list[list[int]] = []
        for x in range(width):
            column = strokes.crop((x, 0, x + 1, height))
            count = column.histogram()[255]
            column.close()
            if count < height * 0.09:
                continue
            if not groups or x > groups[-1][-1] + 1:
                groups.append([x])
            else:
                groups[-1].append(x)
        if any(len(group) > width * 0.006 for group in groups):
            return []
        borders = [round(median(group)) for group in groups]
        if not 6 <= len(borders) <= 15:
            return []
        steps = [right - left for left, right in zip(borders[2:], borders[3:])]
        pitch = median(steps)
        if pitch < width * 0.035 or any(abs(step - pitch) > pitch * 0.08 for step in steps):
            return []
        if not all(0.65 * pitch <= borders[i + 1] - borders[i] <= 2 * pitch for i in (0, 1)):
            return []
        return borders
    finally:
        ink.close()
        strokes.close()


def grid_word_rows(
    data: dict[str, Any], borders: list[int]
) -> list[list[list[dict[str, Any]]]]:
    """Assign each OCR word to its physical cell; never compact blank cells."""
    lines: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for i, raw in enumerate(data.get("text", [])):
        text = str(raw or "").strip()
        if not text:
            continue
        word = {key: int(data[key][i]) for key in ("left", "top", "width", "height")}
        word["source_index"] = i
        word["text"] = text
        try:
            confidence = float(data["conf"][i])
            word["confidence"] = confidence if confidence >= 0 else None
        except (ValueError, TypeError, IndexError):
            word["confidence"] = None
        key = tuple(int(data[key][i]) for key in ("block_num", "par_num", "line_num"))
        lines.setdefault(key, []).append(word)
    result = []
    for words in sorted(lines.values(), key=lambda group: min(word["top"] for word in group)):
        cells: list[list[dict[str, Any]]] = [[] for _ in borders]
        for word in sorted(words, key=lambda word: word["left"]):
            # Long names can touch the first rule. Use the word's left edge;
            # its centre can fall in the following reference column.
            column = bisect_right(borders, word["left"] + 2)
            if column >= len(cells):
                # Page numbers and footer words to the right of the grid must
                # remain visible, but must not invent an extra result column.
                column = len(cells) - 1
            if word["text"] in {"|", "¦"}:
                continue
            cells[column].append(word)
        if any(cells):
            result.append(cells)
    return result


def refine_unit_cells(image: object, data: dict[str, Any], borders: list[int], languages: str, deadline: float) -> None:
    """Re-read specific ambiguous unit glyphs from their own image cells.

    Never infer units from the analyte or result. Valid original units, empty
    cells, dates, references and measurements are left intact. An alternate
    reading must fit the same narrow glyph family; e.g. a missing micro prefix
    cannot be added to a printed g/l, and an alternate ng/l cannot replace yg/l.
    """
    from PIL import Image
    import pytesseract

    attempts = 0
    for row in grid_word_rows(data, borders):
        # Short all-capital labels can be mistaken for different letters.
        # Require both the printed code and name to agree in an independent
        # re-read; no analyte dictionary is used to invent a replacement.
        if (attempts < 16 and "deu" in languages.split("+") and any(row[3:])
                and [word["text"] for word in row[0]] == ["FAL", "FAL"]
                and deadline - time.monotonic() > 0.1):
            attempts += 1
            words = row[0]
            crop = image.crop((max(0, words[0]["left"] - 5), max(0, min(w["top"] for w in words) - 8),
                               borders[0] - 5, min(image.height, max(w["top"] + w["height"] for w in words) + 8)))
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                alternate = pytesseract.image_to_data(crop, lang="deu", config="--oem 1 --psm 7",
                    output_type=pytesseract.Output.DICT, timeout=min(3.0, remaining))
                if [str(t).strip() for t in alternate["text"] if str(t).strip()] == ["FAI", "FAI"]:
                    confidence = min(float(c) for t, c in zip(alternate["text"], alternate["conf"], strict=True) if str(t).strip())
                    for word in words:
                        data["text"][word["source_index"]] = "FAI"
                        data["conf"][word["source_index"]] = min(confidence, word["confidence"] or 0)
            except (RuntimeError, ValueError, TypeError, KeyError):
                pass
            finally:
                crop.close()
        if not row[2] or not any(row[3:]) or attempts >= 16:
            continue
        original = " ".join(word["text"] for word in row[2])
        if re.fullmatch(r"9/[1lI]", original):
            language, acceptable = "deu", r"g/[1lI]"
        elif re.fullmatch(r"yg/[1lI]", original):
            language, acceptable = "eng", r"[uµμ]g/[1lI]"
        elif re.fullmatch(r"(?:yu|y|4W)mol/mmol\s+Chol", original):
            language, acceptable = "deu", r"[uµμ]mol/mmol\s+Cho[l1I\]]"
        else:
            continue
        if language not in languages.split("+") or deadline - time.monotonic() <= 0.1:
            continue
        attempts += 1
        top = max(0, min(word["top"] for word in row[2]) - 8)
        bottom = min(image.height, max(word["top"] + word["height"] for word in row[2]) + 8)
        crop = image.crop((borders[1] + 7, top, borders[2] - 7, bottom))
        try:
            for scale in (2, 1):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                with crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.BICUBIC) as enlarged:
                    alternate = pytesseract.image_to_data(
                        enlarged, lang=language, config="--oem 1 --psm 7",
                        output_type=pytesseract.Output.DICT, timeout=min(3.0, remaining),
                    )
                words = [(str(text).strip(), float(conf)) for text, conf in zip(
                    alternate["text"], alternate["conf"], strict=True
                ) if str(text).strip()]
                text = " ".join(word for word, _ in words)
                if re.fullmatch(acceptable, text):
                    break
            if not re.fullmatch(acceptable, text):
                continue
            # Keep a conservative confidence; a successful re-read does not
            # bypass the worker's review gates. Geometry remains the source cell.
            confidence = min([conf for _, conf in words] + [
                word["confidence"] for word in row[2] if word["confidence"] is not None
            ])
            first = row[2][0]["source_index"]
            data["text"][first] = text
            data["conf"][first] = confidence
            left = min(word["left"] for word in row[2])
            upper = min(word["top"] for word in row[2])
            data["left"][first], data["top"][first] = left, upper
            data["width"][first] = max(word["left"] + word["width"] for word in row[2]) - left
            data["height"][first] = max(word["top"] + word["height"] for word in row[2]) - upper
            for word in row[2][1:]:
                data["text"][word["source_index"]] = ""
        except (RuntimeError, ValueError, TypeError, KeyError):
            # This optional refinement must never discard the complete first pass.
            continue
        finally:
            crop.close()


def analyte_name_column(rows: list[list[list[dict[str, Any]]]], borders: list[int]) -> int | None:
    """Locate a repeated code/name boundary inside the first printed column."""
    body = [row for row in rows if row[0] and any(row[3:])]
    positions = [word["left"] for row in body for word in row[0][1:]]
    if not positions:
        return None
    tolerance = max(3, round((borders[-1] - borders[-2]) * 0.08))
    clusters: list[list[int]] = []
    for position in sorted(positions):
        if not clusters or position - clusters[-1][0] > tolerance:
            clusters.append([position])
        else:
            clusters[-1].append(position)
    cluster = max(clusters, key=len)
    if len(cluster) < max(4, len(body) * 0.5):
        return None
    return min(cluster) - tolerance // 2
