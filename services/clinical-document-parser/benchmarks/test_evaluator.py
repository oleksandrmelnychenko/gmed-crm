from __future__ import annotations

import json
import unittest

from benchmarks.evaluator import (
    candidate_value_similarity,
    character_similarity,
    evaluate_dataset,
    report_passes_gates,
    word_similarity,
)


class EvaluatorTests(unittest.TestCase):
    def test_text_similarities_are_normalized_and_order_sensitive(self) -> None:
        self.assertEqual(character_similarity("A  B\nC", "a b c"), 1.0)
        self.assertEqual(word_similarity("Alpha beta", "alpha beta"), 1.0)
        self.assertLess(word_similarity("alpha beta", "beta alpha"), 1.0)
        self.assertGreater(candidate_value_similarity("Dose 5 mg daily", "Dose\n5 mg daily"), 0.95)
        long_text = "clinical sentence with stable text. " * 1_000
        self.assertEqual(character_similarity(long_text, long_text), 1.0)
        self.assertGreater(
            character_similarity(long_text, long_text.replace("stable", "changed", 1)),
            0.99,
        )

    def test_structured_metrics_assertions_contamination_and_safety(self) -> None:
        forbidden_value = "No acute cardiac failure"
        ground_truth = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "private-case-name",
                    "cohorts": ["arztbrief", "fax_scan"],
                    "reference": {
                        "raw_text": "Diagnosis alpha. History beta.",
                        "candidates": [
                            {
                                "target": "diagnosis",
                                "value": "Diagnosis alpha",
                                "assertion": "confirmed",
                            },
                            {"target": "anamnesis", "value": "History beta"},
                        ],
                    },
                    "section_rules": [
                        {"section": "Diagnoses", "allowed_targets": ["diagnosis"]},
                        {"section": "History", "allowed_targets": ["anamnesis"]},
                    ],
                    "forbidden_diagnoses": [forbidden_value],
                }
            ]
        }
        predictions = {
            "private-case-name": {
                "raw_text": "Diagnosis alpha. History beta.",
                "candidates": [
                    {
                        "target": "diagnosis",
                        "value": "Diagnosis alpha",
                        "normalized": {"certainty": "bestaetigt"},
                        "source": {"section": "Diagnoses"},
                    },
                    {
                        "target": "diagnosis",
                        "value": forbidden_value,
                        "normalized": {"certainty": "bestaetigt"},
                        "source": {"section": "History"},
                    },
                ],
            }
        }

        report = evaluate_dataset(ground_truth, predictions)
        summary = report["summary"]

        self.assertEqual(summary["ocr"]["mean_character_similarity"], 1.0)
        self.assertEqual(summary["candidates"]["by_target"]["diagnosis"]["true_positive"], 1)
        self.assertEqual(summary["candidates"]["by_target"]["diagnosis"]["false_positive"], 1)
        self.assertEqual(summary["candidates"]["by_target"]["anamnesis"]["false_negative"], 1)
        self.assertEqual(summary["candidates"]["macro_f1"], 0.333334)
        self.assertEqual(summary["assertion"]["accuracy"], 1.0)
        self.assertEqual(summary["section_contamination"]["contaminated"], 1)
        self.assertEqual(summary["safety"]["unsafe_false_positive_diagnoses"], 1)
        self.assertFalse(summary["safety"]["passed"])
        self.assertEqual(summary["cohorts"]["fax_scan"]["case_count"], 1)
        self.assertEqual(
            summary["cohorts"]["arztbrief"]["ocr"]["mean_character_similarity"],
            1.0,
        )

        encoded = json.dumps(report)
        self.assertNotIn("private-case-name", encoded)
        self.assertNotIn("Diagnosis alpha", encoded)
        self.assertNotIn(forbidden_value, encoded)

    def test_quality_gates_return_machine_readable_failures(self) -> None:
        report = {
            "summary": {
                "ocr": {"mean_character_similarity": 0.8},
                "candidates": {"micro": {"f1": 0.7}},
                "safety": {"passed": False},
            }
        }
        passed, failures = report_passes_gates(
            report,
            minimum_candidate_f1=0.9,
            minimum_ocr_similarity=0.9,
            fail_on_unsafe=True,
        )
        self.assertFalse(passed)
        self.assertEqual(
            failures,
            [
                "candidate_f1_below_minimum",
                "ocr_similarity_below_minimum",
                "unsafe_false_positive_diagnosis",
            ],
        )

    def test_cohort_gates_expose_small_category_regressions(self) -> None:
        report = {
            "summary": {
                "cohorts": {
                    "fax_scan": {
                        "ocr": {"mean_character_similarity": 0.8},
                        "candidates": {"cases_evaluated": 1, "micro": {"f1": 0.7}},
                    }
                }
            }
        }

        passed, failures = report_passes_gates(
            report,
            minimum_cohort_candidate_f1=0.9,
            minimum_cohort_ocr_similarity=0.9,
        )

        self.assertFalse(passed)
        self.assertEqual(
            failures,
            [
                "cohort_candidate_f1_below_minimum:fax_scan",
                "cohort_ocr_similarity_below_minimum:fax_scan",
            ],
        )

    def test_unknown_cohort_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid cohorts"):
            evaluate_dataset(
                {
                    "schema_version": 1,
                    "cases": [
                        {
                            "case_id": "opaque",
                            "cohorts": ["clinic-name-must-not-be-reported"],
                            "reference": {"raw_text": "Reference"},
                        }
                    ],
                },
                {"opaque": {"raw_text": "Reference"}},
            )

    def test_required_cohort_cannot_silently_disappear(self) -> None:
        report = {
            "summary": {
                "cohorts": {
                    "arztbrief": {
                        "case_count": 1,
                        "ocr": {"mean_character_similarity": 1.0},
                        "candidates": {"cases_evaluated": 1, "micro": {"f1": 1.0}},
                    }
                }
            }
        }

        passed, failures = report_passes_gates(
            report,
            required_cohorts=("arztbrief", "cyrillic", "fax_scan"),
        )

        self.assertFalse(passed)
        self.assertEqual(
            failures,
            ["required_cohort_missing:cyrillic", "required_cohort_missing:fax_scan"],
        )

    def test_required_cohort_must_have_enough_cases(self) -> None:
        report = {
            "summary": {
                "cohorts": {
                    "cyrillic": {
                        "case_count": 2,
                        "ocr": {"mean_character_similarity": 1.0},
                        "candidates": {"cases_evaluated": 2, "micro": {"f1": 1.0}},
                    }
                }
            }
        }

        passed, failures = report_passes_gates(
            report,
            required_cohorts=("cyrillic",),
            minimum_required_cohort_cases=10,
        )

        self.assertFalse(passed)
        self.assertEqual(failures, ["required_cohort_too_small:cyrillic"])

        with self.assertRaisesRegex(ValueError, "needs a required cohort"):
            report_passes_gates(report, minimum_required_cohort_cases=1)

    def test_partially_annotated_case_does_not_turn_all_predictions_into_false_positives(self) -> None:
        ground_truth = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "ocr-only",
                    "reference": {"raw_text": "Reference text"},
                    "forbidden_diagnoses": ["Explicitly absent finding"],
                }
            ],
        }
        predictions = {
            "ocr-only": {
                "raw_text": "Reference text",
                "candidates": [{"target": "diagnosis", "value": "Some diagnosis"}],
            }
        }

        report = evaluate_dataset(ground_truth, predictions)

        self.assertEqual(report["summary"]["candidates"]["cases_evaluated"], 0)
        self.assertEqual(report["summary"]["candidates"]["micro"]["false_positive"], 0)
        self.assertFalse(report["cases"][0]["candidates"]["evaluated"])


if __name__ == "__main__":
    unittest.main()
