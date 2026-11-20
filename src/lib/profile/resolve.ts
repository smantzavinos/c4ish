import type { Profile, ProfileInput } from '../model/types.js';
import { defaultProfile } from './default.js';

/** The catalogs of a profile: each is a record of entries by key. */
export const PROFILE_CATALOGS = [
	'elementKinds',
	'patternFamilies',
	'patterns',
	'relationshipKinds',
	'enforcement',
	'changeStates',
	'lifecycle',
	'areas',
	'views'
] as const;

/**
 * Resolve a profile as written on disk into a complete profile.
 * `extends: "default"` merges over the built-in default: entries with the same key replace the
 * default entry wholesale; new keys are added. A catalog named in `replaces` takes nothing from the
 * default: it holds only the profile's own entries. Without `extends`, missing catalogs are empty.
 */
export function resolveProfile(input?: ProfileInput | Profile | null): Profile {
	if (!input) return defaultProfile;
	const base: Profile | null = input.extends === 'default' ? defaultProfile : null;
	const out: Profile = {
		profileVersion: 0,
		id: input.id,
		title: input.title,
		extends: input.extends,
		...(input.replaces && { replaces: input.replaces }),
		elementKinds: {},
		patternFamilies: {},
		patterns: {},
		relationshipKinds: {},
		enforcement: {},
		changeStates: {},
		lifecycle: {},
		areas: {},
		views: {},
		rules: { ...(base?.rules ?? {}), ...(input.rules ?? {}) },
		divergenceColour: input.divergenceColour ?? base?.divergenceColour ?? '#be123c'
	};
	const replaced = new Set<string>(input.replaces ?? []);
	for (const key of PROFILE_CATALOGS) {
		Object.assign(out[key], replaced.has(key) ? {} : (base?.[key] ?? {}), (input as Partial<Profile>)[key] ?? {});
	}
	return out;
}
