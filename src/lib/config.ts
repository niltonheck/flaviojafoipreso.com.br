import type { PollMode, SiteMode } from './types.ts';

/** Who signs off on status/news by default (see SPEC C §3). Change here if the editor changes. */
export const EDITOR = 'niltonheck';

export const DEFAULT_STATUS_MAX_AGE_HOURS = 72;

export type RuntimeEnv = { MODE?: string; PUBLIC_POLL_MODE?: string; PUBLIC_STATUS_MAX_AGE_HOURS?: string; PUBLIC_AUTOMATION?: string };

export function resolveConfig(env: RuntimeEnv) {
  const mode: SiteMode = env.MODE === 'production' || env.MODE === 'staging' ? env.MODE : 'demo';
  const pollMode: PollMode = (env.PUBLIC_POLL_MODE as PollMode | undefined) ?? (mode === 'demo' ? 'mock' : 'api');
  if (pollMode !== 'mock' && pollMode !== 'api') throw new Error(`PUBLIC_POLL_MODE inválido: ${pollMode}`);
  // Build-time guard: the mock poll must never reach the production domain.
  if (mode === 'production' && pollMode === 'mock') {
    throw new Error('PUBLIC_POLL_MODE=mock é proibido em builds de produção.');
  }
  const maxAge = Number(env.PUBLIC_STATUS_MAX_AGE_HOURS ?? DEFAULT_STATUS_MAX_AGE_HOURS);
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error('PUBLIC_STATUS_MAX_AGE_HOURS inválido.');
  // Build-time switch for the footer wording only; it must match the runtime AUTOMATION_ENABLED of that deploy.
  const automation = env.PUBLIC_AUTOMATION === 'on';
  return { mode, pollMode, statusMaxAgeHours: maxAge, automation };
}
