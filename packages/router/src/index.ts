import type { ModelSelection, TaskSignals } from "@hifi/core";
import type { ModelPreference } from "@hifi/db";

/**
 * Rules-based model selection. Nothing learned in v1.
 *
 * Implemented in M3. The logging that a learned router would later train on is
 * built first: every job persists its signals, its selection, its token counts,
 * and eventually whether the pull request was merged or closed.
 */

export interface TenantConfig {
  tenantId: string;
  preference: ModelPreference;
  /** Providers this tenant actually has a credential for. */
  availableProviders: string[];
}

export interface RouterInput {
  signals: TaskSignals;
  tenant: TenantConfig;
}

export interface Router {
  selectModel(input: RouterInput): Promise<ModelSelection>;
  /**
   * Vision pre-pass model. Capability comes from the ModelEntry table and is
   * never inferred from the model name.
   */
  selectVisionModel(input: RouterInput): Promise<ModelSelection>;
}
