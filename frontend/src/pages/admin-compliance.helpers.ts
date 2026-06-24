export type ConsentAction = "grant" | "revoke";

export function buildConsentFormPatchAfterSuccess(action: ConsentAction) {
  if (action === "revoke") {
    return {
      consentExpiresAt: "",
      consentNote: "",
    };
  }

  return {
    consentNote: "",
  };
}
