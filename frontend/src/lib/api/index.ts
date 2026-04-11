// Re-export all API modules for convenient imports:
//   import { fetchUsers, fetchLeads, ... } from "@/lib/api"
//   import type { User, Lead, ... } from "@/lib/api"

export * from "./types";
export * from "./client";

export * as users from "./users";
export * as accessPolicies from "./access-policies";
export * as stats from "./stats";
export * as leads from "./leads";
export * as patients from "./patients";
export * as providers from "./providers";
export * as orders from "./orders";
export * as cases from "./cases";
export * as appointments from "./appointments";
export * as messages from "./messages";
export * as notifications from "./notifications";
export * as admin from "./admin";
export * as visitorIntakes from "./visitor-intakes";
