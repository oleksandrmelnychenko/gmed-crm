from __future__ import annotations

from collections import Counter, defaultdict
from difflib import SequenceMatcher
import math
import re
import unicodedata
from typing import Any, Mapping, Sequence


TARGETS = ("diagnosis", "anamnesis", "medication", "examination", "recommendation")
_WORD_RE = re.compile(r"\w+", re.UNICODE)


def _normalized_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(text.split())


def _tokens(value: object) -> list[str]:
    return _WORD_RE.findall(_normalized_text(value))


def _safe_ratio(left: Sequence[object], right: Sequence[object]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right, autojunk=len(left) + len(right) > 20_000).ratio()


def character_similarity(reference: object, prediction: object) -> float:
    """Return an order-sensitive similarity after Unicode/whitespace normalization."""

    left = _normalized_text(reference)
    right = _normalized_text(prediction)
    if len(left) + len(right) <= 20_000:
        return _safe_ratio(left, right)
    # SequenceMatcher's character-level worst case is quadratic and its
    # autojunk heuristic is inaccurate for long natural-language documents.
    # Character 5-gram Dice similarity stays linear while preserving local
    # order and OCR sensitivity.
    left_ngrams = Counter(left[index : index + 5] for index in range(max(1, len(left) - 4)))
    right_ngrams = Counter(right[index : index + 5] for index in range(max(1, len(right) - 4)))
    overlap = sum((left_ngrams & right_ngrams).values())
    denominator = sum(left_ngrams.values()) + sum(right_ngrams.values())
    return 2.0 * overlap / denominator if denominator else 1.0


def word_similarity(reference: object, prediction: object) -> float:
    """Return an order-sensitive token similarity after Unicode normalization."""

    return _safe_ratio(_tokens(reference), _tokens(prediction))


def _token_overlap_similarity(reference: object, prediction: object) -> float:
    reference_counts = Counter(_tokens(reference))
    prediction_counts = Counter(_tokens(prediction))
    if not reference_counts and not prediction_counts:
        return 1.0
    overlap = sum((reference_counts & prediction_counts).values())
    denominator = sum(reference_counts.values()) + sum(prediction_counts.values())
    return 2.0 * overlap / denominator if denominator else 0.0


def candidate_value_similarity(reference: object, prediction: object) -> float:
    """Blend ordered and bag-of-words scores to tolerate OCR line wrapping."""

    ordered = word_similarity(reference, prediction)
    overlap = _token_overlap_similarity(reference, prediction)
    characters = character_similarity(reference, prediction)
    return max(characters, (ordered + overlap) / 2.0)


_ASSERTION_ALIASES = {
    "active": "active",
    "aktiv": "active",
    "confirmed": "confirmed",
    "bestaetigt": "confirmed",
    "bestatigt": "confirmed",
    "bestätigt": "confirmed",
    "final": "confirmed",
    "family": "family",
    "family_history": "family",
    "familienanamnese": "family",
    "historical": "historical",
    "history": "historical",
    "zustand_nach": "historical",
    "negated": "negated",
    "negative": "negated",
    "excluded": "negated",
    "rule_out": "negated",
    "suspected": "suspected",
    "suspicious": "suspected",
    "verdacht": "suspected",
}


def canonical_assertion(value: object) -> str | None:
    normalized = _normalized_text(value).replace("-", "_").replace(" ", "_")
    if not normalized:
        return None
    return _ASSERTION_ALIASES.get(normalized, normalized)


def _candidate_assertion(candidate: Mapping[str, Any]) -> str | None:
    direct = candidate.get("assertion")
    if direct is not None:
        return canonical_assertion(direct)
    normalized = candidate.get("normalized")
    if isinstance(normalized, Mapping):
        for key in ("assertion", "certainty", "status"):
            if normalized.get(key) is not None:
                return canonical_assertion(normalized[key])
    return None


def _candidate_section(candidate: Mapping[str, Any]) -> str:
    source = candidate.get("source")
    if isinstance(source, Mapping):
        return str(source.get("section") or "")
    return str(candidate.get("section") or "")


def _prf(true_positive: int, false_positive: int, false_negative: int) -> dict[str, float | int]:
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    f1 = 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
    }


def _case_reference(index: int) -> str:
    # Never copy, hash, or otherwise pseudonymize the external identifier into
    # reports. Unsalted hashes of MRNs/names can be linkable or brute-forced.
    return f"case-{index + 1:03d}"


def _as_mapping_list(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _match_candidates(
    references: list[Mapping[str, Any]],
    predictions: list[Mapping[str, Any]],
    threshold: float,
) -> tuple[list[tuple[int, int, float]], list[int], list[int]]:
    edges: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for reference_index, reference in enumerate(references):
        target = reference.get("target")
        for prediction_index, prediction in enumerate(predictions):
            if prediction.get("target") != target:
                continue
            score = candidate_value_similarity(reference.get("value"), prediction.get("value"))
            if score >= threshold:
                edges[reference_index].append((prediction_index, score))
    for candidates in edges.values():
        candidates.sort(key=lambda item: item[1], reverse=True)

    # Maximum-cardinality bipartite matching prevents a locally strong greedy
    # match from turning another otherwise matchable reference into a false
    # negative. Score ordering still prefers the closest assignment.
    prediction_owner: dict[int, int] = {}

    def augment(reference_index: int, visited_predictions: set[int]) -> bool:
        for prediction_index, _ in edges.get(reference_index, []):
            if prediction_index in visited_predictions:
                continue
            visited_predictions.add(prediction_index)
            owner = prediction_owner.get(prediction_index)
            if owner is None or augment(owner, visited_predictions):
                prediction_owner[prediction_index] = reference_index
                return True
        return False

    for reference_index in sorted(range(len(references)), key=lambda index: len(edges.get(index, []))):
        augment(reference_index, set())

    matches: list[tuple[int, int, float]] = []
    for prediction_index, reference_index in prediction_owner.items():
        score = next(
            score
            for candidate_prediction_index, score in edges[reference_index]
            if candidate_prediction_index == prediction_index
        )
        matches.append((reference_index, prediction_index, score))
    matched_references = {reference_index for reference_index, _, _ in matches}
    matched_predictions = {prediction_index for _, prediction_index, _ in matches}

    unmatched_references = [index for index in range(len(references)) if index not in matched_references]
    unmatched_predictions = [index for index in range(len(predictions)) if index not in matched_predictions]
    return matches, unmatched_references, unmatched_predictions


def _section_allowed(
    candidate: Mapping[str, Any], section_rules: list[Mapping[str, Any]], threshold: float
) -> tuple[bool, bool]:
    section = _candidate_section(candidate)
    if not section:
        return False, False
    best: Mapping[str, Any] | None = None
    best_score = 0.0
    for rule in section_rules:
        score = candidate_value_similarity(rule.get("section"), section)
        if score > best_score:
            best = rule
            best_score = score
    if best is None or best_score < threshold:
        return False, False
    allowed_targets = best.get("allowed_targets")
    if not isinstance(allowed_targets, list):
        return True, True
    return True, candidate.get("target") in allowed_targets


def _forbidden_diagnosis_values(case: Mapping[str, Any]) -> list[object]:
    values: list[object] = []
    for item in case.get("forbidden_diagnoses", []):
        if isinstance(item, Mapping):
            values.append(item.get("value"))
        else:
            values.append(item)
    return [item for item in values if _normalized_text(item)]


def evaluate_dataset(
    ground_truth: Mapping[str, Any],
    predictions: Mapping[str, Mapping[str, Any]],
    *,
    candidate_match_threshold: float = 0.84,
    section_match_threshold: float = 0.86,
) -> dict[str, Any]:
    """Evaluate parser output without copying clinical content into the report.

    ``ground_truth`` owns the only reference text/candidate values. ``predictions``
    is keyed by external case id. The returned dictionary contains counts,
    similarities, and hashed case references only.
    """

    if not 0.0 <= candidate_match_threshold <= 1.0:
        raise ValueError("candidate_match_threshold must be between 0 and 1")
    if not 0.0 <= section_match_threshold <= 1.0:
        raise ValueError("section_match_threshold must be between 0 and 1")
    if ground_truth.get("schema_version") != 1:
        raise ValueError("unsupported or missing ground-truth schema_version")
    cases = ground_truth.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("ground truth must contain a non-empty cases array")

    target_totals: dict[str, Counter[str]] = defaultdict(Counter)
    candidate_cases_evaluated = 0
    ocr_character_scores: list[float] = []
    ocr_word_scores: list[float] = []
    assertion_correct = 0
    assertion_evaluated = 0
    contaminated = 0
    section_evaluated = 0
    unsafe_diagnoses = 0
    diagnosis_predictions = 0
    cases_with_unsafe = 0
    missing_prediction_cases = 0
    case_reports: list[dict[str, Any]] = []
    seen_case_ids: set[str] = set()

    for case_index, raw_case in enumerate(cases):
        if not isinstance(raw_case, Mapping):
            raise ValueError(f"case at index {case_index} must be an object")
        case_id = str(raw_case.get("case_id") or f"case-{case_index + 1}")
        if case_id in seen_case_ids:
            raise ValueError("ground truth case_id values must be unique")
        seen_case_ids.add(case_id)
        prediction = predictions.get(case_id)
        if not isinstance(prediction, Mapping):
            prediction = {}
            missing_prediction_cases += 1

        reference = raw_case.get("reference")
        if not isinstance(reference, Mapping):
            raise ValueError(f"case at index {case_index} must contain a reference object")
        candidate_reference_present = isinstance(reference.get("candidates"), list)
        references = _as_mapping_list(reference.get("candidates"))
        predicted_candidates = _as_mapping_list(prediction.get("candidates"))
        if candidate_reference_present:
            candidate_cases_evaluated += 1
            matches, unmatched_references, unmatched_predictions = _match_candidates(
                references, predicted_candidates, candidate_match_threshold
            )
        else:
            matches, unmatched_references, unmatched_predictions = [], [], []

        per_target: dict[str, dict[str, float | int]] = {}
        target_names = set(TARGETS) if candidate_reference_present else set()
        target_names.update(str(item.get("target")) for item in references if item.get("target"))
        if candidate_reference_present:
            target_names.update(
                str(item.get("target")) for item in predicted_candidates if item.get("target")
            )
        matched_reference_ids = {reference_index for reference_index, _, _ in matches}
        matched_prediction_ids = {prediction_index for _, prediction_index, _ in matches}
        for target in sorted(target_names):
            true_positive = sum(1 for index in matched_reference_ids if references[index].get("target") == target)
            false_negative = sum(
                1 for index in unmatched_references if references[index].get("target") == target
            )
            false_positive = sum(
                1 for index in unmatched_predictions if predicted_candidates[index].get("target") == target
            )
            target_totals[target]["tp"] += true_positive
            target_totals[target]["fp"] += false_positive
            target_totals[target]["fn"] += false_negative
            per_target[target] = _prf(true_positive, false_positive, false_negative)

        case_assertion_correct = 0
        case_assertion_evaluated = 0
        for reference_index, prediction_index, _ in matches:
            expected_assertion = _candidate_assertion(references[reference_index])
            if expected_assertion is None:
                continue
            case_assertion_evaluated += 1
            if expected_assertion == _candidate_assertion(predicted_candidates[prediction_index]):
                case_assertion_correct += 1
        assertion_correct += case_assertion_correct
        assertion_evaluated += case_assertion_evaluated

        section_rules = _as_mapping_list(raw_case.get("section_rules"))
        case_contaminated = 0
        case_section_evaluated = 0
        for candidate in predicted_candidates:
            evaluated, allowed = _section_allowed(candidate, section_rules, section_match_threshold)
            if evaluated:
                case_section_evaluated += 1
                if not allowed:
                    case_contaminated += 1
        contaminated += case_contaminated
        section_evaluated += case_section_evaluated

        forbidden = _forbidden_diagnosis_values(raw_case)
        case_unsafe = 0
        case_diagnosis_predictions = 0
        for candidate in predicted_candidates:
            if candidate.get("target") != "diagnosis":
                continue
            case_diagnosis_predictions += 1
            if any(
                candidate_value_similarity(forbidden_value, candidate.get("value"))
                >= candidate_match_threshold
                for forbidden_value in forbidden
            ):
                case_unsafe += 1
        diagnosis_predictions += case_diagnosis_predictions
        unsafe_diagnoses += case_unsafe
        cases_with_unsafe += int(case_unsafe > 0)

        ocr_metrics: dict[str, Any] | None = None
        if "raw_text" in reference:
            character_score = character_similarity(reference.get("raw_text"), prediction.get("raw_text"))
            word_score = word_similarity(reference.get("raw_text"), prediction.get("raw_text"))
            ocr_character_scores.append(character_score)
            ocr_word_scores.append(word_score)
            ocr_metrics = {
                "character_similarity": round(character_score, 6),
                "word_similarity": round(word_score, 6),
            }

        assertion_accuracy = (
            case_assertion_correct / case_assertion_evaluated if case_assertion_evaluated else None
        )
        contamination_rate = (
            case_contaminated / case_section_evaluated if case_section_evaluated else None
        )
        case_reports.append(
            {
                "case_ref": _case_reference(case_index),
                "prediction_present": bool(prediction),
                "ocr": ocr_metrics,
                "candidates": {
                    "evaluated": candidate_reference_present,
                    "reference_count": len(references),
                    "prediction_count": len(predicted_candidates),
                    "matched_count": len(matches),
                    "by_target": per_target,
                },
                "assertion": {
                    "correct": case_assertion_correct,
                    "evaluated": case_assertion_evaluated,
                    "accuracy": round(assertion_accuracy, 6) if assertion_accuracy is not None else None,
                },
                "section_contamination": {
                    "contaminated": case_contaminated,
                    "evaluated": case_section_evaluated,
                    "rate": round(contamination_rate, 6) if contamination_rate is not None else None,
                },
                "safety": {
                    "unsafe_false_positive_diagnoses": case_unsafe,
                    "diagnosis_predictions": case_diagnosis_predictions,
                    "passed": case_unsafe == 0,
                },
            }
        )

    by_target: dict[str, dict[str, float | int]] = {}
    for target in sorted(target_totals):
        totals = target_totals[target]
        by_target[target] = _prf(totals["tp"], totals["fp"], totals["fn"])
    total_tp = sum(totals["tp"] for totals in target_totals.values())
    total_fp = sum(totals["fp"] for totals in target_totals.values())
    total_fn = sum(totals["fn"] for totals in target_totals.values())
    macro_f1_values = [
        float(metrics["f1"])
        for metrics in by_target.values()
        if int(metrics["true_positive"])
        + int(metrics["false_positive"])
        + int(metrics["false_negative"])
        > 0
    ]
    assertion_accuracy = assertion_correct / assertion_evaluated if assertion_evaluated else None
    contamination_rate = contaminated / section_evaluated if section_evaluated else None
    unsafe_rate = unsafe_diagnoses / diagnosis_predictions if diagnosis_predictions else 0.0

    return {
        "schema_version": 1,
        "privacy": {
            "clinical_content_included": False,
            "document_paths_included": False,
            "case_identifiers": "ordinal-only",
        },
        "configuration": {
            "candidate_match_threshold": candidate_match_threshold,
            "section_match_threshold": section_match_threshold,
        },
        "summary": {
            "case_count": len(cases),
            "missing_prediction_cases": missing_prediction_cases,
            "ocr": {
                "cases_evaluated": len(ocr_character_scores),
                "mean_character_similarity": round(
                    sum(ocr_character_scores) / len(ocr_character_scores), 6
                )
                if ocr_character_scores
                else None,
                "mean_word_similarity": round(sum(ocr_word_scores) / len(ocr_word_scores), 6)
                if ocr_word_scores
                else None,
            },
            "candidates": {
                "cases_evaluated": candidate_cases_evaluated,
                "micro": _prf(total_tp, total_fp, total_fn),
                "macro_f1": round(sum(macro_f1_values) / len(macro_f1_values), 6)
                if macro_f1_values
                else 0.0,
                "by_target": by_target,
            },
            "assertion": {
                "correct": assertion_correct,
                "evaluated": assertion_evaluated,
                "accuracy": round(assertion_accuracy, 6) if assertion_accuracy is not None else None,
            },
            "section_contamination": {
                "contaminated": contaminated,
                "evaluated": section_evaluated,
                "rate": round(contamination_rate, 6) if contamination_rate is not None else None,
            },
            "safety": {
                "unsafe_false_positive_diagnoses": unsafe_diagnoses,
                "diagnosis_predictions": diagnosis_predictions,
                "unsafe_rate": round(unsafe_rate, 6),
                "cases_with_unsafe_false_positives": cases_with_unsafe,
                "passed": unsafe_diagnoses == 0,
            },
        },
        "cases": case_reports,
    }


def report_passes_gates(
    report: Mapping[str, Any],
    *,
    minimum_candidate_f1: float | None = None,
    minimum_ocr_similarity: float | None = None,
    fail_on_unsafe: bool = False,
) -> tuple[bool, list[str]]:
    failures: list[str] = []
    summary = report.get("summary")
    if not isinstance(summary, Mapping):
        return False, ["invalid_report"]
    if minimum_candidate_f1 is not None:
        candidates = summary.get("candidates")
        micro = candidates.get("micro") if isinstance(candidates, Mapping) else None
        f1 = micro.get("f1") if isinstance(micro, Mapping) else None
        if not isinstance(f1, (int, float)) or not math.isfinite(f1) or f1 < minimum_candidate_f1:
            failures.append("candidate_f1_below_minimum")
    if minimum_ocr_similarity is not None:
        ocr = summary.get("ocr")
        similarity = ocr.get("mean_character_similarity") if isinstance(ocr, Mapping) else None
        if (
            not isinstance(similarity, (int, float))
            or not math.isfinite(similarity)
            or similarity < minimum_ocr_similarity
        ):
            failures.append("ocr_similarity_below_minimum")
    if fail_on_unsafe:
        safety = summary.get("safety")
        passed = safety.get("passed") if isinstance(safety, Mapping) else False
        if passed is not True:
            failures.append("unsafe_false_positive_diagnosis")
    return not failures, failures
