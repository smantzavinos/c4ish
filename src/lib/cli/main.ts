#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { check } from '../api.js';
import type { Diagnostic } from '../model/validate.js';
import { renderView } from '../render/page.js';
import { exportTour } from '../render/tour-export.js';
import { tourCoverage } from '../model/tours.js';
import { serveViewer } from './serve.js';

const USAGE = `c4ish — reviewable architecture diagrams of a planned change

Usage:
  c4ish validate <model.json> [--profile p.json] [--strict]
  c4ish render   <model.json> [--profile p.json] [--view id | --all] [--out file.svg] [--png] [--appendix]
  c4ish tour     <model.json> [--profile p.json] [--tour id] [--out dir] [--png]
  c4ish view     <model.json> [--profile p.json] [--tour [id]] [--step id] [--port n] [--no-open] [--rebuild]

validate  Schema + semantic checks + notation lint. Exit 1 on errors (or warnings with --strict).
render    Writes SVG. --all renders every view to <out-dir or model dir>/<view>.svg.
          --png also rasterises with ImageMagick (magick) when available.
tour      Writes one SVG per tour step plus index.html (offline slideshow) and tour.md into
          --out (default <model dir>/tour; one sub-directory per tour when there are several).
view      Serves the offline viewer on localhost with this model (and profile) loaded, opens the
          browser and live-reloads when either file changes. --tour starts the (named or first)
          tour, --step at that step. Uses the prebuilt viewer (build/; built once if missing).
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
			// --tour may stand alone (view: start the first tour)
			const takes = ['profile', 'view', 'out', 'density', 'step', 'port'].includes(key) || (key === 'tour' && !next?.startsWith('--') && !/\.json$/i.test(next ?? ''));
			if (takes && next !== undefined) {
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
	if (cmd === 'tour') return writeTours(file, result, flags);
	if (cmd === 'view') return view(file, flags, errors, warns);
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
		const res = await renderView(model, result.profile, { view, appendix: flags.has('appendix') });
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
		if (res.appendix) {
			const md = out.replace(/\.svg$/, '') + '.appendix.md';
			writeFileSync(md, res.appendix);
			console.error(`wrote ${md}`);
		}
		if (flags.has('png')) toPng(out, flags);
	}
	return 0;
}

async function view(file: string, flags: Map<string, string | true>, errors: number, warns: number): Promise<number> {
	const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
	const port = str('port') ? Number(str('port')) : undefined;
	if (port !== undefined && !Number.isInteger(port)) {
		console.error(`--port must be a number`);
		return 1;
	}
	console.error(`${file}: ${errors} error(s), ${warns} warning(s)`);
	const server = await serveViewer({
		file,
		profile: str('profile'),
		tour: flags.has('tour') ? (str('tour') ?? true) : undefined,
		step: str('step'),
		port,
		open: !flags.has('no-open'),
		rebuild: flags.has('rebuild'),
		onChange: () => {
			try {
				const { modelJson, profileJson } = load(file, flags.get('profile'));
				const ds = check(modelJson, profileJson).diagnostics;
				const e = ds.filter((d) => d.severity === 'error').length;
				console.error(`${new Date().toLocaleTimeString()} reloaded ${file}: ${e} error(s), ${ds.length - e} warning(s)`);
			} catch (err) {
				console.error(`${new Date().toLocaleTimeString()} ${(err as Error).message}`);
			}
		}
	});
	console.error(`c4ish viewer: ${server.url}\n(watching for changes; Ctrl+C to stop)`);
	return new Promise<number>((done) => {
		const stop = () => {
			server.close();
			done(0);
		};
		process.once('SIGINT', stop);
		process.once('SIGTERM', stop);
	});
}

function toPng(svgFile: string, flags: Map<string, string | true>): void {
	const png = svgFile.replace(/\.svg$/, '') + '.png';
	const density = typeof flags.get('density') === 'string' ? (flags.get('density') as string) : '110';
	try {
		execFileSync('magick', ['-density', density, '-background', 'white', svgFile, png], { stdio: 'inherit' });
		console.error(`wrote ${png}`);
	} catch {
		console.error('warning: PNG skipped (ImageMagick "magick" not available or failed)');
	}
}

async function writeTours(file: string, result: ReturnType<typeof check>, flags: Map<string, string | true>): Promise<number> {
	if (!result.ok || !result.model || !result.profile) {
		console.error(`${file}: tour not exported (errors)`);
		return 1;
	}
	const model = result.model;
	const wanted = flags.get('tour');
	const tours = (model.tours ?? []).filter((t) => typeof wanted !== 'string' || t.id === wanted);
	if (!tours.length) {
		console.error(`${file}: no ${typeof wanted === 'string' ? `tour "${wanted}"` : 'tours'} in the model`);
		return 1;
	}
	let uncovered = 0;
	for (const tour of tours) {
		const cov = tourCoverage(model, result.profile, tour);
		uncovered += cov.uncovered.length;
		console.error(`coverage (tour "${tour.id}"): ${cov.items.length - cov.uncovered.length}/${cov.items.length} review items pointed at${cov.uncovered.length ? ` — uncovered: ${cov.uncovered.map((u) => u.id).join(', ')}` : ''}`);
	}
	const outFlag = flags.get('out');
	const root = typeof outFlag === 'string' ? resolve(outFlag) : resolve(dirname(file), 'tour');
	for (const tour of tours) {
		const dir = tours.length > 1 ? resolve(root, tour.id) : root;
		mkdirSync(dir, { recursive: true });
		const ex = await exportTour(model, result.profile, tour);
		for (const s of ex.steps) {
			const out = resolve(dir, s.file);
			writeFileSync(out, s.svg);
			console.error(`wrote ${out} (${s.width}×${s.height})`);
			if (flags.has('png')) toPng(out, flags);
		}
		writeFileSync(resolve(dir, 'index.html'), ex.html);
		writeFileSync(resolve(dir, 'tour.md'), ex.markdown);
		console.error(`wrote ${resolve(dir, 'index.html')}, tour.md`);
	}
	return uncovered && flags.has('strict') ? 1 : 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(e) => {
		console.error(`c4ish: ${(e as Error).message}`);
		process.exit(2);
	}
);
