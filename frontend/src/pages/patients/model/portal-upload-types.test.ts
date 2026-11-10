import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { CHAT_ATTACHMENT_ACCEPT } from "@/pages/chat/model/attachments";

import {
  PORTAL_UPLOAD_ACCEPT,
  PORTAL_UPLOAD_MAX_BYTES,
  PORTAL_UPLOAD_PROBLEM_KEYS,
  portalUploadProblem,
} from "./portal-upload-types";

describe("portal document upload types (global QA 2026-11-10)", () => {
  it("takes the same document types as a chat attachment", () => {
    expect(PORTAL_UPLOAD_ACCEPT.split(",").sort()).toEqual(CHAT_ATTACHMENT_ACCEPT.split(",").sort());
  });

  it("refuses programs, scripts and files without an extension", () => {
    for (const name of ["qa-b-test.exe", "qa-b-second.bat.exe", "qa-b-script.sh", "page.html", "archive.zip", "noextension", ".pdf"]) {
      expect(portalUploadProblem({ name, size: 10 }), name).toBe("type");
    }
    for (const name of ["Befund.PDF", "pass.jpeg", "scan.heic", "labor.xlsx", "mrt.dcm"]) {
      expect(portalUploadProblem({ name, size: 10 }), name).toBeNull();
    }
  });

  it("refuses an empty file and one over the server limit", () => {
    expect(portalUploadProblem({ name: "leer.pdf", size: 0 })).toBe("empty");
    expect(portalUploadProblem({ name: "gross.pdf", size: PORTAL_UPLOAD_MAX_BYTES + 1 })).toBe("size");
    expect(portalUploadProblem({ name: "passt.pdf", size: PORTAL_UPLOAD_MAX_BYTES })).toBeNull();
  });

  it("has a Russian and a German text for every problem", () => {
    for (const key of Object.values(PORTAL_UPLOAD_PROBLEM_KEYS)) {
      expect(t("ru").uiText[key], key).toBeTruthy();
      expect(t("de").uiText[key], key).toBeTruthy();
    }
  });
});
