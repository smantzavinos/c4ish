#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { check } from '../api.js';
import type { Diagnostic } from '../model/validate.js';
import { renderView } from '../render/page.js';

const USAGE = `c4ish — reviewable architecture diagrams of a planned change

Usage:
  c4ish validate <model.json> [--profile p.json] [--strict]
  c4ish render   <model.json> [--profile p.json] [--view id | --all] [--out file.svg] [--png] [--no-details]

validate  Schema + semantic checks + notation lint. Exit 1 on errors (or warnings with --strict).
render    Writes SVG. --all renders every view to <out-dir or model dir>/<view>.svg.
          --png also rasterises with ImageMagick (magick) when available.
Profile:  --profile wins; else the model's "profile" path (relative to the model); else the default.`;

interface Args {
	cmd?: string;
	file?: string;
	flags: Map<string, string | true>;
}

function parse(argv: string[]): Args {
	const flags = new Map<string, string | true>();
	const pos: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (['profile', 'view', 'out', 'density'].includes(key) && next !== undefined) {
				flags.set(key, next);
				i++;
			} else flags.set(key, true);
		} else pos.push(a);
	}
	return { cmd: pos[0], file: pos[1], flags };
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		throw new Error(`cannot read ${path}: ${(e as Error).message}`);
	}
}

function printDiagnostics(file: string, ds: Diagnostic[]) {
	for (const d of ds) {
		const tag = d.severity === 'error' ? 'error  ' : 'warning';
		console.error(`${tag} ${file}${d.at ? ` [${d.at}]` : ''}: ${d.message} (${d.code})`);
	}
}

function load(file: string, profileFlag: string | true | undefined) {
	const modelJson = readJson(file) as { profile?: string };
	let profilePath: string | undefined;
	if (typeof profileFlag === 'string') profilePath = resolve(profileFlag);
	else if (modelJson && typeof modelJson.profile === 'string') profilePath = resolve(dirname(file), modelJson.profile);
	const profileJson = profilePath ? readJson(profilePath) : undefined;
	return { modelJson, profileJson, profilePath };
}

async function main(argv: string[]): Promise<number> {
	const { cmd, file, flags } = parse(argv);
	if (!cmd || flags.has('help') || cmd === 'help') {
		console.log(USAGE);
		return cmd ? 0 : 1;
	}
	if (!file) {
		console.error(`missing <model.json>\n\n${USAGE}`);
		return 1;
	}
	const { modelJson, profileJson } = load(file, flags.get('profile'));
	const result = check(modelJson, profileJson);
	printDiagnostics(file, result.diagnostics);
	const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
	const warns = result.diagnostics.length - errors;

	if (cmd === 'validate' || cmd === 'lint') {
		console.error(`${file}: ${errors} error(s), ${warns} warning(s)`);
		return errors || (flags.has('strict') && warns) ? 1 : 0;
	}
	if (cmd !== 'render') {
		console.error(`unknown command "${cmd}"\n\n${USAGE}`);
		return 1;
	}
	if (!result.ok || !result.model || !result.profile) {
		console.error(`${file}: not rendered (${errors} error(s))`);
		return 1;
	}
	const model = result.model;
	const views = flags.has('all') ? model.views.map((v) => v.id) : [typeof flags.get('view') === 'string' ? (flags.get('view') as string) : model.views[0].id];
	const outFlag = flags.get('out');
	for (const view of views) {
		const res = await renderView(model, result.profile, { view, details: !flags.has('no-details') });
		for (const w of res.warnings) console.error(`warning ${file} [view:${view}]: ${w}`);
		let out: string | undefined;
		if (views.length > 1 || flags.has('all')) out = resolve(typeof outFlag === 'string' ? outFlag : dirname(file), `${view}.svg`);
		else if (typeof outFlag === 'string') out = resolve(outFlag);
		if (!out) {
			process.stdout.write(res.svg + '\n');
			continue;
		}
		writeFileSync(out, res.svg);
		console.error(`wrote ${out} (${res.width}×${res.height})`);
		if (flags.has('png')) {
			const png = out.replace(/\.svg$/, '') + '.png';
			const density = typeof flags.get('density') === 'string' ? (flags.get('density') as string) : '110';
			try {
				execFileSync('magick', ['-density', density, '-background', 'white', out, png], { stdio: 'inherit' });
				console.error(`wrote ${png}`);
			} catch {
				console.error('warning: PNG skipped (ImageMagick "magick" not available or failed)');
			}
		}
	}
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(e) => {
		console.error(`c4ish: ${(e as Error).message}`);
		process.exit(2);
	}
);
