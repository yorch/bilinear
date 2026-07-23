/**
 * The five per-org plan-tier caps (the `Organization.max*` columns), in a
 * stable display order with their i18n label keys. Shared by the platform-admin
 * editor (`(admin)/admin/tenants/[id]`) and the org's read-only settings view
 * (`(workspace)/[workspace]/settings`) so both render the same set, labels, and
 * ordering. `Team.upcomingCycleCount` is intentionally excluded — it's a
 * per-team knob, not an org-wide plan limit.
 */
export interface OrganizationPlanLimits {
  maxCustomFieldsPerOrg: number;
  maxCustomFieldsPerTeam: number;
  maxExportRows: number;
  maxInitiativeDepth: number;
  maxLabelGroupChildren: number;
}

export type PlanLimitKey = keyof OrganizationPlanLimits;

export const PLAN_LIMIT_FIELDS: ReadonlyArray<{ key: PlanLimitKey; labelKey: string }> = [
  { key: 'maxCustomFieldsPerTeam', labelKey: 'planLimits.maxCustomFieldsPerTeam' },
  { key: 'maxCustomFieldsPerOrg', labelKey: 'planLimits.maxCustomFieldsPerOrg' },
  { key: 'maxLabelGroupChildren', labelKey: 'planLimits.maxLabelGroupChildren' },
  { key: 'maxInitiativeDepth', labelKey: 'planLimits.maxInitiativeDepth' },
  { key: 'maxExportRows', labelKey: 'planLimits.maxExportRows' },
];
