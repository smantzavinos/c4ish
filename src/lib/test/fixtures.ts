import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const EXAMPLES = ['paged-reads', 'versioned-wiring'] as const;

export function loadExample(name: string): { model: unknown; profile: unknown } {
	const file = resolve('examples', name, 'model.c4ish.json');
	const model = JSON.parse(readFileSync(file, 'utf8')) as { profile?: string };
	const profile = model.profile ? JSON.parse(readFileSync(resolve(dirname(file), model.profile), 'utf8')) : undefined;
	return { model, profile };
}

export function clone<T>(x: T): T {
	return JSON.parse(JSON.stringify(x)) as T;
}
