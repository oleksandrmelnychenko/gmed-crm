#!/usr/bin/env node
/**
 * Fail the build if staff-facing code bypasses RBAC-safe navigation patterns.
 *
 * See docs/testing/ui-rbac-route-guard-plan_ua.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripTsCommentsForScan } from "./staff-spa-navigation-shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, "..", "src");

/** Whole-file skip (basename). */
const EXCLUDED_BASENAMES = new Set(
  [
    "login.tsx",
    "use-staff-navigate.ts",
    "staff-link.tsx",
    "topbar.tsx",
    "nav-panel.tsx",
    "layout.tsx",
    "patient-dashboard.tsx",
    "patient-invoices.tsx",
    "patient-appointments.tsx",
    "patient-documents.tsx",
    "patient-privacy.tsx",
    "patient-services.tsx",
  ].map((s) => s.toLowerCase()),
);

/** Raw `<Link to="/` or `` to={`/ `` (react-router Link, not StaffLink). */
const RAW_LINK_SPA =
  /<Link\b[^>]*\bto=\{\s*[`'"]\/|<Link\b[^>]*\bto=["']\//;

/** `<Navigate to="/…` (redirect shell lives in allowlisted layout). */
const RAW_NAVIGATE_COMPONENT_SPA =
  /<Navigate\b[^>]*\bto=\{\s*[`'"]\/|<Navigate\b[^>]*\bto=["']\//;

/** Only nav-panel may use NavLink for app sidebar. */
const NAVLINK_OPEN = /<NavLink\b/;

function posixRel(fromRoot, absPath) {
  return path.relative(fromRoot, absPath).split(path.sep).join("/");
}

function shouldScanFile(relPosix) {
  const base = path.basename(relPosix).toLowerCase();
  if (EXCLUDED_BASENAMES.has(base)) {
    return false;
  }
  if (relPosix.includes("/ui/")) {
    return false;
  }
  if (relPosix.endsWith(".test.ts") || relPosix.endsWith(".test.tsx")) {
    return false;
  }
  return true;
}

function* walkTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkTsFiles(full);
    } else if (ent.isFile() && /\.tsx?$/.test(ent.name)) {
      yield full;
    }
  }
}

const issues = [];

for (const abs of walkTsFiles(SRC_ROOT)) {
  const rel = posixRel(SRC_ROOT, abs);
  if (!shouldScanFile(rel)) {
    continue;
  }
  const rawText = fs.readFileSync(abs, "utf8");
  const text = stripTsCommentsForScan(rawText);
  const base = path.basename(rel).toLowerCase();
  const lines = rawText.split("\n");

  if (/\bnavigate\s*\(/.test(text)) {
    issues.push({
      rel,
      line: 1,
      kind: "navigate-forbidden",
      text: "navigate( is only allowed in login / use-staff-navigate / topbar (use staffGo elsewhere)",
    });
  }

  if (base !== "nav-panel.tsx" && NAVLINK_OPEN.test(rawText)) {
    issues.push({
      rel,
      line: 1,
      kind: "navlink-forbidden",
      text: "NavLink is reserved for nav-panel.tsx (use StaffLink or staffGo)",
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      continue;
    }
    if (RAW_LINK_SPA.test(line)) {
      issues.push({ rel, line: i + 1, kind: "link", text: trimmed });
    }
    if (RAW_NAVIGATE_COMPONENT_SPA.test(line)) {
      issues.push({ rel, line: i + 1, kind: "navigate-element", text: trimmed });
    }
  }
}

if (issues.length > 0) {
  const msg = issues
    .map((x) => `${x.rel}:${x.line} [${x.kind}] ${x.text}`)
    .join("\n");
  console.error(
    "Staff SPA navigation guard failed. Use useStaffNavigate().staffGo, staffHrefIfAllowed, or <StaffLink>.\n\n",
    msg,
  );
  process.exit(1);
}

console.log("Staff SPA navigation guard: OK");
