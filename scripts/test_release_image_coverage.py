"""Keep the complete DEV and PROD image sets aligned."""

from pathlib import Path
import re
import tomllib
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

    def test_fast_dev_profile_preserves_production_optimizations(self):
        cargo = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
        self.assertEqual(cargo["profile"]["release"], {
            "opt-level": "s", "lto": True, "codegen-units": 1, "strip": "symbols",
        })
        self.assertEqual(cargo["profile"]["dev-fast"], {
            "inherits": "release", "opt-level": 1, "lto": "off",
            "codegen-units": 16, "incremental": False,
        })
        dockerfile = (ROOT / "Dockerfile.backend").read_text(encoding="utf-8")
        self.assertIn("ARG GMED_CARGO_PROFILE=release\n", dockerfile)
        self.assertIn("ARG GMED_CARGO_BUILD_JOBS=\n", dockerfile)
        self.assertIn('cargo build --locked --profile "$GMED_CARGO_PROFILE"', dockerfile)
        self.assertIn('cp "target/$GMED_CARGO_PROFILE/gmed-server"', dockerfile)
        self.assertIn('export CARGO_BUILD_JOBS="$GMED_CARGO_BUILD_JOBS"', dockerfile)

    def test_only_source_dev_deployment_selects_fast_profile(self):
        dev = (ROOT / "docker-compose.dev-hetzner.yml").read_text(encoding="utf-8")
        self.assertIn('GMED_CARGO_PROFILE: "dev-fast"', dev)
        self.assertIn('GMED_CARGO_BUILD_JOBS: "1"', dev)
        for name in (
            "docker-compose.yml", "docker-compose.release.yml",
            "docker-compose.prod-hetzner.yml", ".github/workflows/release.yml",
        ):
            with self.subTest(file=name):
                self.assertNotIn("dev-fast", (ROOT / name).read_text(encoding="utf-8"))

    def test_both_dev_deployment_paths_rehearse_migrations_before_swap(self):
        script = (ROOT / "scripts/deploy-dev-current.sh").read_text(encoding="utf-8")
        branch_end = script.index("  unset COMPOSE_BAKE\nfi\n")
        preflight = script.index('python3 "$STAGING_DIR/scripts/preflight-prod-migrations.py"')
        prepare = script.index('prepare_upload_volume "$STAGING_DIR"')
        swap = script.index('mv "$REPO_DIR" "$BACKUP_PATH"')
        self.assertLess(branch_end, preflight)
        self.assertLess(preflight, prepare)
        self.assertLess(prepare, swap)
        self.assertEqual(script.count('scripts/preflight-prod-migrations.py"'), 1)
        self.assertIn('--backup-dir "$BACKUP_DIR/database-$STAMP"', script)


if __name__ == "__main__":
    unittest.main()
