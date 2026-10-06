import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";

import {
  fetchLeadPayerPackage,
  prepareLeadPayerPackage,
  sendLeadPayerPackage,
  type LeadPayerPackageState,
  type PayerPackageSendInput,
} from "../data/lead-payer-package-api";
import { payerPackageChanged } from "./lead-payer-package";

/** What the signature flow hands to the package panel. */
export type LeadPayerPackageController = {
  /** The state; null while loading, on an older server, or after a failed first load. */
  data: LeadPayerPackageState | null;
  loading: boolean;
  /** The last failed load; a 404 (older server) is not an error. */
  error: unknown;
  reload: () => Promise<LeadPayerPackageState | null>;
  prepare: () => Promise<LeadPayerPackageState | null>;
  send: (input: PayerPackageSendInput) => Promise<LeadPayerPackageState | null>;
};

/**
 * What the rest of the wizard reads of a package (the declaration's badge,
 * the payer link panel, the documents): another value means it is to be
 * loaded afresh.
 */
function packageFingerprint(state: LeadPayerPackageState | null): string {
  const pkg = state?.package;
  if (!pkg) return `none:${state?.blocked_reason ?? ""}`;
  return [
    pkg.id,
    pkg.status,
    pkg.outdated_reasons.join(","),
    pkg.request_id ?? "",
    pkg.signed_at ?? "",
    pkg.documents.map((item) => `${item.document_id}:${item.signed_at ?? ""}`).join(","),
  ].join("|");
}

/**
 * Loads the payer's signature package of a lead
 * (`GET /leads/{id}/payer-signature-package`) and keeps it fresh: on
 * `lead.portal_updated` with the change `payer_package` or `payer_link`, when
 * the window regains focus (Skribble's result arrives meanwhile) and after
 * the actions, whose answers are the state. A server without the endpoint
 * (404) reads as "no package": nothing is shown. `onChanged` runs when a
 * loaded package differs from the one before (not on the first load).
 */
export function useLeadPayerPackage(
  leadId: string | null | undefined,
  enabled = true,
  onChanged?: () => void,
): LeadPayerPackageController {
  const [data, setData] = useState<LeadPayerPackageState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestRef = useRef(0);
  const onChangedRef = useRef(onChanged);
  const fingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const reload = useCallback(async () => {
    if (!leadId || !enabled) {
      setData(null);
      return null;
    }
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const next = await fetchLeadPayerPackage(leadId);
      if (request === requestRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    } catch (nextError) {
      if (request === requestRef.current) {
        const olderServer = nextError instanceof ApiRequestError && nextError.status === 404;
        if (olderServer) setData(null);
        setError(olderServer ? null : nextError);
      }
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [enabled, leadId]);

  /** An action: its answer replaces the state; a refused one is followed by a reload (the state moved on). */
  const write = useCallback(
    async (action: (id: string) => Promise<LeadPayerPackageState | null>) => {
      if (!leadId) return null;
      // A load still on its way would bring the state of before: the answer of the action wins.
      const request = ++requestRef.current;
      let next: LeadPayerPackageState | null;
      try {
        next = await action(leadId);
      } catch (cause) {
        void reload();
        throw cause;
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
      if (!next) return reload();
      if (request === requestRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    },
    [leadId, reload],
  );

  const prepare = useCallback(() => write((id) => prepareLeadPayerPackage(id)), [write]);
  const send = useCallback((input: PayerPackageSendInput) => write((id) => sendLeadPayerPackage(id, input)), [write]);

  useEffect(() => {
    setData(null);
    fingerprintRef.current = null;
    void reload();
  }, [reload]);

  // Skribble's result reaches the server by its worker: look again when staff come back.
  useEffect(() => {
    if (!leadId || !enabled) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, leadId, reload]);

  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (!enabled || !leadId || event.entity_id !== leadId) return;
    if (payerPackageChanged(event.payload?.change)) void reload();
  });

  useEffect(() => {
    if (!data) return;
    const next = packageFingerprint(data);
    const previous = fingerprintRef.current;
    fingerprintRef.current = next;
    if (previous !== null && previous !== next) onChangedRef.current?.();
  }, [data]);

  return { data, loading, error, reload, prepare, send };
}
