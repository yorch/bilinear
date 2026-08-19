/**
 * Client helpers for the configuration registry.
 *
 * Shared by the platform console (`/admin/config`) and the workspace settings
 * pages — both render the same knobs from the same declarations, differing
 * only in scope and in which knobs the caller's role lets through.
 */
import type { SettingScope } from './config';
import { gqlMutate, gqlQuery } from './graphql';

/** A knob as the server resolved it, including where the value came from. */
export interface ResolvedSettingDto {
  editableBy: string;
  enumValues: string[] | null;
  envIsSet: boolean;
  envVarName: string | null;
  key: string;
  labelKey: string;
  locked: boolean;
  max: number | null;
  min: number | null;
  redacted: boolean;
  restartRequired: boolean;
  scopes: SettingScope[];
  source: string;
  type: string;
  value: boolean | number | string | null;
}

const SETTING_FIELDS = `
  key value source locked type scopes editableBy labelKey
  min max enumValues restartRequired redacted envVarName envIsSet
`;

export function fetchSettings(
  scope: SettingScope,
  scopeId?: string | null,
): Promise<ResolvedSettingDto[]> {
  return gqlQuery(
    `query Settings($scope: SettingScope!, $scopeId: ID) {
      settings(scope: $scope, scopeId: $scopeId) { ${SETTING_FIELDS} }
    }`,
    { scope, scopeId: scopeId ?? null },
    'settings',
  );
}

export async function setSetting(
  key: string,
  scope: SettingScope,
  value: boolean | number | string,
  scopeId?: string | null,
): Promise<ResolvedSettingDto> {
  const data = await gqlMutate(
    `mutation SettingSet($input: SettingWriteInput!) {
      settingSet(input: $input) { success setting { ${SETTING_FIELDS} } }
    }`,
    { input: { key, scope, scopeId: scopeId ?? null, value } },
  );
  return (data as { settingSet: { setting: ResolvedSettingDto } }).settingSet.setting;
}

/**
 * Reset to inherited: removes the stored row so the knob falls back to the
 * layer below. Deliberately distinct from writing the default — a stored
 * default still shadows a later change to the platform value.
 */
export async function clearSetting(
  key: string,
  scope: SettingScope,
  scopeId?: string | null,
): Promise<ResolvedSettingDto> {
  const data = await gqlMutate(
    `mutation SettingClear($key: String!, $scope: SettingScope!, $scopeId: ID) {
      settingClear(key: $key, scope: $scope, scopeId: $scopeId) {
        success setting { ${SETTING_FIELDS} }
      }
    }`,
    { key, scope, scopeId: scopeId ?? null },
  );
  return (data as { settingClear: { setting: ResolvedSettingDto } }).settingClear.setting;
}

/** Group knobs by the first segment of their dotted key, for section headings. */
export function groupByArea(settings: ResolvedSettingDto[]): Array<{
  area: string;
  items: ResolvedSettingDto[];
}> {
  const groups = new Map<string, ResolvedSettingDto[]>();
  for (const s of settings) {
    const area = s.key.split('.')[0];
    const existing = groups.get(area);
    if (existing) {
      existing.push(s);
    } else {
      groups.set(area, [s]);
    }
  }
  return [...groups.entries()]
    .map(([area, items]) => ({ area, items }))
    .sort((a, b) => a.area.localeCompare(b.area));
}
