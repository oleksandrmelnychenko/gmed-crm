"""Keep the complete DEV and PROD image sets aligned."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
IMAGE_SERVICES = {
    "server": "backend",
    "frontend": "frontend",
    "clinical-document-parser": "clinical-document-parser",
    "invoice-parser": "invoice-parser",
}


class ReleaseImageCoverageTests(unittest.TestCase):
    def test_both_workflows_build_all_application_images(self):
        for name in ("dev.yml", "release.yml"):
            with self.subTest(workflow=name):
                workflow = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
                images = re.findall(r"^          - name: ([\w-]+)$", workflow, re.MULTILINE)
                self.assertCountEqual(images, IMAGE_SERVICES)
                self.assertIn("Verify invoice parser runtime before signing", workflow)
                self.assertIn("--network none --read-only", workflow)

    def test_registry_override_removes_all_local_builds(self):
        compose = (ROOT / "docker-compose.ghcr.yml").read_text(encoding="utf-8")
        for service in IMAGE_SERVICES.values():
            with self.subTest(service=service):
                self.assertRegex(
                    compose,
                    rf"(?m)^  {re.escape(service)}:\n"
                    r"    build: !reset null\n"
                    r'    image: "\$\{GMED_[A-Z_]+_IMAGE:\?[^\n]+\n'
                    r"    pull_policy: always",
                )

    def test_image_tags_match_the_frontend_build_number(self):
        for name, prefix in (("dev.yml", "dev-sha-"), ("release.yml", "release-sha-")):
            with self.subTest(workflow=name):
                workflow = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
                version = prefix + "${{ steps.source.outputs.short_sha }}"
                self.assertIn("type=raw,value=" + version, workflow)
                self.assertIn("VITE_BUILD_NUMBER=" + version, workflow)
                self.assertIn("org.opencontainers.image.version=", workflow)

    def test_dev_pull_includes_all_application_services(self):
        script = (ROOT / "scripts/deploy-dev.sh").read_text(encoding="utf-8")
        pull = re.search(r"(?m)^  docker compose .+ pull (.+)$", script)
        self.assertIsNotNone(pull)
        self.assertCountEqual(pull.group(1).split(), IMAGE_SERVICES.values())
        self.assertIn('invoice_parser_image="$(env_value GMED_INVOICE_PARSER_IMAGE)"', script)

    def test_ci_checks_invoice_parser_before_automatic_dev_build(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertIn("\n  invoice-parser:\n", workflow)
        self.assertIn("working-directory: services/invoice-parser", workflow)
        self.assertIn("run: python -m pytest -q", workflow)


if __name__ == "__main__":
    unittest.main()
