import type { Model, Profile, ProfileInput } from './model/types.js';
import { validateModel, validateModelSchema, validateProfileSchema, type Diagnostic } from './model/validate.js';
import { resolveProfile } from './profile/resolve.js';

export interface CheckResult {
	ok: boolean;
	diagnostics: Diagnostic[];
	model?: Model;
	profile?: Profile;
}

/**
 * Validate a model (and optional profile) given as parsed JSON: schema first, then semantics and
 * notation lint. `ok` is false when any error is present; warnings don't fail.
 */
export function check(modelJson: unknown, profileJson?: unknown): CheckResult {
	const diagnostics: Diagnostic[] = [];
	if (profileJson !== undefined && profileJson !== null) diagnostics.push(...validateProfileSchema(profileJson).map((d) => ({ ...d, at: `profile${d.at}` })));
	diagnostics.push(...validateModelSchema(modelJson));
	if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics };
	const profile = resolveProfile((profileJson as ProfileInput | undefined) ?? null);
	const model = modelJson as Model;
	diagnostics.push(...validateModel(model, profile));
	return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics, model, profile };
}
