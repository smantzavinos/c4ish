import type { Profile, ProfileInput } from '../model/types.js';
import { defaultProfile } from './default.js';

const RECORD_KEYS = [
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
 * default entry wholesale; new keys are added. Without `extends`, missing catalogs are empty.
 */
export function resolveProfile(input?: ProfileInput | Profile | null): Profile {
	if (!input) return defaultProfile;
	const base: Profile | null = input.extends === 'default' ? defaultProfile : null;
	const out: Profile = {
		profileVersion: 0,
		id: input.id,
		title: input.title,
		extends: input.extends,
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
	for (const key of RECORD_KEYS) {
		Object.assign(out[key], base?.[key] ?? {}, (input as Partial<Profile>)[key] ?? {});
	}
	return out;
}
