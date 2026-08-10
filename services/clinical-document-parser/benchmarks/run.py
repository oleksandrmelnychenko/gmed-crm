from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Mapping

from benchmarks.evaluator import ALLOWED_COHORTS, evaluate_dataset, report_passes_gates


def _load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unable to load JSON input: {type(exc).__name__}") from exc


def _prediction_map(payload: object) -> dict[str, Mapping[str, Any]]:
    if isinstance(payload, Mapping):
        cases = payload.get("cases", payload)
        if isinstance(cases, Mapping):
            return {str(key): value for key, value in cases.items() if isinstance(value, Mapping)}
        if isinstance(cases, list):
            return {
                str(item["case_id"]): item
                for item in cases
                if isinstance(item, Mapping) and item.get("case_id") is not None
            }
    raise ValueError("predictions must contain a cases object or array")


def _run_parser(ground_truth: Mapping[str, Any], ground_truth_path: Path) -> dict[str, Mapping[str, Any]]:
    from app.extraction import extract_text
    from app.parser import parse_clinical_text

    raw_cases = ground_truth.get("cases")
    if not isinstance(raw_cases, list):
        raise ValueError("ground truth cases must be an array")
    predictions: dict[str, Mapping[str, Any]] = {}
    for index, case in enumerate(raw_cases):
        if not isinstance(case, Mapping):
            raise ValueError(f"ground truth case {index} must be an object")
        case_id = str(case.get("case_id") or f"case-{index + 1}")
        document = case.get("document")
        if not isinstance(document, Mapping) or not document.get("path"):
            raise ValueError(f"ground truth case {index} must contain document.path")
        document_path = Path(str(document["path"]))
        if not document_path.is_absolute():
            document_path = ground_truth_path.parent / document_path
        try:
            data = document_path.read_bytes()
            existing_text = None
            if document.get("existing_text_path"):
                text_path = Path(str(document["existing_text_path"]))
                if not text_path.is_absolute():
                    text_path = ground_truth_path.parent / text_path
                existing_text = text_path.read_text(encoding="utf-8")
            extracted_text = extract_text(
                data,
                str(document.get("mime_type") or "application/pdf"),
                existing_text=existing_text,
            )
            predictions[case_id] = parse_clinical_text(extracted_text).model_dump(mode="json")
        except Exception as exc:
            # Keep paths and clinical content out of terminal output and reports.
            print(
                f"case {index + 1}: parser failed ({type(exc).__name__})",
                file=sys.stderr,
            )
            predictions[case_id] = {}
    return predictions


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate clinical document OCR/extraction without emitting clinical content."
    )
    parser.add_argument("--ground-truth", type=Path, required=True, help="External JSON ground truth")
    parser.add_argument(
        "--predictions",
        type=Path,
        help="External JSON predictions; when omitted, parse document.path for every case",
    )
    parser.add_argument("--output", type=Path, help="Write the PHI-safe report to this path")
    parser.add_argument("--candidate-match-threshold", type=float, default=0.84)
    parser.add_argument("--section-match-threshold", type=float, default=0.86)
    parser.add_argument("--minimum-candidate-f1", type=float)
    parser.add_argument("--minimum-ocr-similarity", type=float)
    parser.add_argument("--minimum-cohort-candidate-f1", type=float)
    parser.add_argument("--minimum-cohort-ocr-similarity", type=float)
    parser.add_argument(
        "--required-cohort",
        action="append",
        default=[],
        choices=sorted(ALLOWED_COHORTS),
        help="Require a fixed cohort to be present; repeat for multiple cohorts",
    )
    parser.add_argument(
        "--minimum-required-cohort-cases",
        type=int,
        help="Minimum case count for each cohort named by --required-cohort",
    )
    parser.add_argument("--fail-on-unsafe", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        ground_truth = _load_json(args.ground_truth)
        if not isinstance(ground_truth, Mapping):
            raise ValueError("ground truth must be a JSON object")
        if args.predictions:
            predictions = _prediction_map(_load_json(args.predictions))
        else:
            predictions = _run_parser(ground_truth, args.ground_truth)
        report = evaluate_dataset(
            ground_truth,
            predictions,
            candidate_match_threshold=args.candidate_match_threshold,
            section_match_threshold=args.section_match_threshold,
        )
        passed, failures = report_passes_gates(
            report,
            minimum_candidate_f1=args.minimum_candidate_f1,
            minimum_ocr_similarity=args.minimum_ocr_similarity,
            minimum_cohort_candidate_f1=args.minimum_cohort_candidate_f1,
            minimum_cohort_ocr_similarity=args.minimum_cohort_ocr_similarity,
            required_cohorts=args.required_cohort,
            minimum_required_cohort_cases=args.minimum_required_cohort_cases,
            fail_on_unsafe=args.fail_on_unsafe,
        )
        report["gates"] = {"passed": passed, "failures": failures}
        encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding="utf-8")
        else:
            sys.stdout.write(encoded)
        return 0 if passed else 2
    except ValueError as exc:
        print(f"benchmark configuration error: {exc}", file=sys.stderr)
        return 64
    except OSError:
        print("benchmark I/O error", file=sys.stderr)
        return 74


if __name__ == "__main__":
    raise SystemExit(main())
