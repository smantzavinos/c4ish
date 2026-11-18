#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { check } from '../api.js';
import type { Diagnostic } from '../model/validate.js';
import { renderView } from '../render/page.js';
import { exportTour } from '../render/tour-export.js';
import { tourCoverage } from '../model/tours.js';
import { packageRoot, serveViewer } from './serve.js';

const USAGE = `c4ish — reviewable architecture diagrams of a planned change

Usage:
  c4ish validate <model.json> [--profile p.json] [--strict]
  c4ish render   <model.json> [--profile p.json] [--view id | --all] [--out file.svg] [--png] [--appendix]
  c4ish tour     <model.json> [--profile p.json] [--tour id] [--out dir] [--png]
  c4ish view     <model.json> [--profile p.json] [--tour [id]] [--step id] [--port n] [--no-open] [--rebuild]
  c4ish code     <model.json> [--profile p.json] [--base commit] [--root dir] [--json]
  c4ish guide
  c4ish schema   [model | profile]
  c4ish --version

validate  Schema + semantic checks + notation lint. Exit 1 on errors (or warnings with --strict).
render    Writes SVG. --all renders every view to <out-dir or model dir>/<view>.svg.
          --png also rasterises with ImageMagick (magick) when available.
tour      Writes one SVG per tour step plus index.html (offline slideshow) and tour.md into
          --out (default <model dir>/tour; one sub-directory per tour when there are several).
view      Serves the offline viewer on localhost with this model (and profile) loaded, opens the
          browser and live-reloads when either file changes. --tour starts the (named or first)
          tour, --step at that step. Uses the prebuilt viewer (build/; built once if missing).
code      Finds the code each element's "code" references name (path, path#Name, path#Outer.Inner),
          relative to --root (default: the git repository holding the model). With --base it also
          resolves them at that commit, says what changed in each, and lists every changed line with
          the references that contain it. --json prints the full report. Exit 1 when a reference
          cannot be used as written.
guide     Prints the authoring reference: how to write a model, with one complete example.
schema    Prints the JSON Schema of a model (default) or a profile.
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
			const takes = ['profile', 'view', 'out', 'density', 'step', 'port', 'base', 'root'].includes(key) || (key === 'tour' && !next?.startsWith('--') && !/\.json$/i.test(next ?? ''));
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

/** The schema version this build reads, taken from the shipped JSON Schema so it cannot drift. */
function schemaVersion(which: 'model' | 'profile'): number {
	const schema = JSON.parse(readFileSync(join(packageRoot(), 'schema', `${which}.schema.json`), 'utf8')) as { properties: Record<string, { const: number }> };
	return schema.properties[which === 'model' ? 'schemaVersion' : 'profileVersion'].const;
}

/** Commands that take no model file. Returns undefined when `cmd` is not one of them. */
function info(cmd: string | undefined, arg: string | undefined, flags: Map<string, string | true>): number | undefined {
	if (flags.has('version') || cmd === 'version') {
		const { version } = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version: string };
		console.log(`c4ish ${version} (model schema v${schemaVersion('model')}, profile schema v${schemaVersion('profile')})`);
		return 0;
	}
	if (cmd === 'guide') {
		process.stdout.write(readFileSync(join(packageRoot(), 'docs', 'AUTHORING.md'), 'utf8'));
		return 0;
	}
	if (cmd === 'schema') {
		const which = arg ?? 'model';
		if (which !== 'model' && which !== 'profile') {
			console.error(`unknown schema "${which}" (model or profile)`);
			return 1;
		}
		process.stdout.write(readFileSync(join(packageRoot(), 'schema', `${which}.schema.json`), 'utf8'));
		return 0;
	}
	return undefined;
}

async function main(argv: string[]): Promise<number> {
	const { cmd, file, flags } = parse(argv);
	const done = info(cmd, file, flags);
	if (done !== undefined) return done;
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
	if (cmd === 'code') return code(file, result, flags);
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

async function code(file: string, result: ReturnType<typeof check>, flags: Map<string, string | true>): Promise<number> {
	if (!result.ok || !result.model || !result.profile) {
		console.error(`${file}: code references not resolved (errors)`);
		return 1;
	}
	// Loaded here so the other commands never start the parser.
	const { codeReport, repositoryRoot } = await import('../code/report.js');
	const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
	const root = str('root') ? resolve(str('root')!) : repositoryRoot(dirname(resolve(file)));
	if (!root) {
		console.error(`${file} is not inside a git repository; pass --root <dir>`);
		return 1;
	}
	const report = await codeReport(result.model, result.profile, { root, base: str('base') });
	if (flags.has('json')) {
		process.stdout.write(JSON.stringify(report, null, '\t') + '\n');
		return report.problems ? 1 : 0;
	}
	const span = (side?: { extents?: { start: number; end: number }[] }) => (side?.extents ?? []).map((e) => `L${e.start}–${e.end}`).join(', ');
	console.log(`${report.references.length} code reference(s) in ${root}${report.base ? `, ${report.base.slice(0, 10)} → working tree` : ''}`);
	for (const r of report.references) {
		const state = r.problem ? 'PROBLEM' : (r.delta ?? r.head.status);
		const where = span(r.head.status === 'resolved' ? r.head : r.base);
		const who = r.owners.map((o) => (o.part ? `${o.element} / ${o.part}` : o.element)).join(', ');
		console.log(`  ${state.padEnd(10)} ${r.ref}${where ? `  ${where}` : ''}  [${who}]`);
		const more = [
			r.problem,
			r.commentChanged ? 'the comment above it changed' : '',
			r.changedThrough ? `changed through ${r.changedThrough.join(', ')}` : '',
			...(r.hints ?? []).map((h) => `${h.kind} to ${h.ref}?`)
		].filter(Boolean);
		for (const m of more) console.log(`             ${m}`);
	}
	if (report.files && report.unowned) {
		const u = report.unowned;
		console.log(`${report.files.length} changed file(s); ${u.lines} changed line(s) inside no reference (${u.ranges} range(s) in ${u.files} file(s))`);
		const listed = report.files.flatMap((f) => {
			const loose = [...f.head.filter((x) => !x.refs.length).map((x) => `+${x.start}–${x.end}`), ...f.base.filter((x) => !x.refs.length).map((x) => `-${x.start}–${x.end}`)];
			return loose.length || f.binary ? [`  ${f.path} (${f.status}${f.binary ? ', binary' : ''})  ${loose.join(' ')}`] : [];
		});
		const LIMIT = 40;
		listed.slice(0, LIMIT).forEach((l) => console.log(l));
		if (listed.length > LIMIT) console.log(`  … and ${listed.length - LIMIT} more file(s); --json lists them all`);
	}
	if (report.problems) console.error(`${file}: ${report.problems} code reference(s) cannot be used as written`);
	return report.problems ? 1 : 0;
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
