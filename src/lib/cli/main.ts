#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { check } from '../api.js';
import { validateModelSchema, validateProfile, validateProfileSchema, type Diagnostic } from '../model/validate.js';
import { resolveProfile } from '../profile/resolve.js';
import { ASPECT_NAMES, describeField, diffModels, filterDiff, type Aspect } from '../model/diff.js';
import { differenceModel } from '../model/diff-tour.js';
import type { Model, ProfileInput } from '../model/types.js';
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
  c4ish code     <profile.json> [--base commit] [--root dir] [--json]
  c4ish diff     <old.json> <new.json> [--only aspects] [--json] [--out review.json] [--profile p.json]
  c4ish diff     <model.json> --base commit [--only aspects] [--json] [--out review.json] [--profile p.json]
  c4ish profile  [profile.json]
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
          cannot be used as written. Given a profile instead of a model, it does the same for the
          reference implementations its patterns name ("code" on a pattern), without the list of
          changed lines.
diff      Compares two versions of a model, item by item, matched by id. The earlier version is a
          file, or with --base the same file at that commit. Every difference has an aspect:
          structure, text, code, presentation or provenance; --only keeps the ones listed
          (comma-separated). --json prints the full comparison. --out writes a review model: the
          later version with one generated tour that walks what differs (open it with
          "c4ish view <review.json> --tour", or export it with "c4ish tour"). Exit 1 only when a
          version cannot be read.
profile   Prints a profile as c4ish reads it, as JSON: the file with the default profile merged in
          when it extends it, or the default profile when no file is given. Exit 1 on errors.
guide     Prints the authoring reference: how to write a model, with one complete example.
schema    Prints the JSON Schema of a model (default) or a profile.
Profile:  --profile wins; else the model's "profile" path (relative to the model); else the default.`;

interface Args {
	cmd?: string;
	file?: string;
	/** A second file (diff). */
	other?: string;
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
			const takes = ['profile', 'view', 'out', 'density', 'step', 'port', 'base', 'root', 'only'].includes(key) || (key === 'tour' && !next?.startsWith('--') && !/\.json$/i.test(next ?? ''));
			if (takes && next !== undefined) {
				flags.set(key, next);
				i++;
			} else flags.set(key, true);
		} else pos.push(a);
	}
	return { cmd: pos[0], file: pos[1], other: pos[2], flags };
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

/** A profile file, checked; its problems are printed and it is not returned when it has any. */
function readProfile(file: string): ProfileInput | undefined {
	const json = readJson(file);
	const problems = validateProfileSchema(json);
	if (!problems.length) problems.push(...validateProfile(json as ProfileInput));
	printDiagnostics(file, problems);
	if (problems.length) console.error(`${file}: ${problems.length} error(s)`);
	return problems.length ? undefined : (json as ProfileInput);
}

const isProfileFile = (json: unknown): boolean => typeof json === 'object' && json !== null && 'profileVersion' in json && !('schemaVersion' in json);

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
	if (cmd === 'profile') {
		if (arg === undefined) {
			process.stdout.write(JSON.stringify(resolveProfile(), null, '\t') + '\n');
			return 0;
		}
		const profile = readProfile(arg);
		if (profile) process.stdout.write(JSON.stringify(resolveProfile(profile), null, '\t') + '\n');
		return profile ? 0 : 1;
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
	const { cmd, file, other, flags } = parse(argv);
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
	if (cmd === 'diff') return diff(file, other, flags);
	if (cmd === 'code' && isProfileFile(readJson(file))) return patternCode(file, flags);
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
	return printCodeReport(file, report, flags, (o) => (o.part ? `${o.element} / ${o.part}` : o.element));
}

/** `c4ish code <profile.json>`: where the reference implementations of its patterns are. */
async function patternCode(file: string, flags: Map<string, string | true>): Promise<number> {
	const profile = readProfile(file);
	if (!profile) return 1;
	const { patternCodeReport, repositoryRoot } = await import('../code/report.js');
	const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
	const root = str('root') ? resolve(str('root')!) : repositoryRoot(dirname(resolve(file)));
	if (!root) {
		console.error(`${file} is not inside a git repository; pass --root <dir>`);
		return 1;
	}
	const report = await patternCodeReport(resolveProfile(profile), { root, base: str('base') });
	return printCodeReport(file, report, flags, (o) => `pattern ${o.pattern}`);
}

function printCodeReport<Owner>(file: string, report: import('../code/report.js').CodeReport<Owner>, flags: Map<string, string | true>, owner: (o: Owner) => string): number {
	const root = report.root;
	if (flags.has('json')) {
		process.stdout.write(JSON.stringify(report, null, '\t') + '\n');
		return report.problems ? 1 : 0;
	}
	const span = (side?: { extents?: { start: number; end: number }[] }) => (side?.extents ?? []).map((e) => `L${e.start}–${e.end}`).join(', ');
	console.log(`${report.references.length} code reference(s) in ${root}${report.base ? `, ${report.base.slice(0, 10)} → working tree` : ''}`);
	for (const r of report.references) {
		const state = r.problem ? 'PROBLEM' : (r.delta ?? r.head.status);
		const where = span(r.head.status === 'resolved' ? r.head : r.base);
		const who = r.owners.map(owner).join(', ');
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

/** The file as it was at a commit, parsed. */
function readJsonAt(file: string, commit: string): unknown {
	const dir = dirname(resolve(file));
	const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
	let path: string;
	try {
		// the directory's path inside the repository, as git sees it (symlinks resolved)
		path = git(['rev-parse', '--show-prefix']).trim() + basename(file);
	} catch {
		throw new Error(`${file} is not inside a git repository; give the earlier version as a file`);
	}
	try {
		return JSON.parse(git(['show', `${commit}:${path}`]));
	} catch (e) {
		const detail = (e as { stderr?: string }).stderr?.trim().split('\n')[0] ?? (e as Error).message;
		throw new Error(`cannot read ${path} at ${commit}: ${detail}`);
	}
}

function diff(first: string, second: string | undefined, flags: Map<string, string | true>): number {
	const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
	const base = str('base');
	if (!second && !base) {
		console.error(`diff needs two files, or one file and --base <commit>\n\n${USAGE}`);
		return 1;
	}
	if (second && base) {
		console.error('diff takes two files or --base, not both');
		return 1;
	}
	const newFile = second ?? first;
	const oldName = base ? `${first} at ${base}` : first;
	const only = str('only')?.split(',').map((a) => a.trim());
	const unknown = only?.filter((a) => !ASPECT_NAMES.includes(a as Aspect));
	if (unknown?.length) {
		console.error(`unknown aspect "${unknown.join('", "')}" (${ASPECT_NAMES.join(', ')})`);
		return 1;
	}

	const oldJson = base ? readJsonAt(first, base) : readJson(first);
	const { modelJson, profileJson } = load(newFile, flags.get('profile'));
	// the earlier version only has to be well formed: its profile may have moved on since
	const oldErrors = validateModelSchema(oldJson);
	printDiagnostics(oldName, oldErrors);
	const wantsReview = str('out') !== undefined;
	const checked = wantsReview ? check(modelJson, profileJson) : undefined;
	const newErrors = (checked?.diagnostics ?? validateModelSchema(modelJson)).filter((d) => d.severity === 'error');
	printDiagnostics(newFile, newErrors);
	if (oldErrors.length || newErrors.length) {
		console.error('not compared (errors)');
		return 1;
	}

	const full = diffModels(oldJson as Model, modelJson as Model);
	const result = only ? filterDiff(full, only as Aspect[]) : full;

	if (wantsReview) {
		const out = resolve(str('out')!);
		const review = differenceModel(oldJson as Model, checked!.model!, checked!.profile!, result);
		// the review model may sit elsewhere: keep its profile path pointing at the same file
		if (typeof review.profile === 'string') review.profile = relative(dirname(out), resolve(dirname(newFile), review.profile));
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, JSON.stringify(review, null, '\t') + '\n');
		console.error(`wrote ${out} (${review.tours![0].steps.length} step(s)); open with: c4ish view ${str('out')} --tour`);
	}
	if (flags.has('json')) {
		process.stdout.write(JSON.stringify(result, null, '\t') + '\n');
		return 0;
	}
	const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
	const counts = ASPECT_NAMES.filter((a) => result.counts[a]).map((a) => `${result.counts[a]} ${a}`);
	console.log(`${oldName} → ${newFile}: ${total} difference(s)${counts.length ? ` (${counts.join(', ')})` : ''}${only ? `, ${only.join(' and ')} only` : ''}`);
	for (const d of result.differences) {
		console.log(`  ${d.change.padEnd(8)} ${d.kind} ${d.id}${d.fields ? '' : `  [${d.aspects[0]}]`}`);
		for (const f of d.fields ?? []) console.log(`           ${f.aspect.padEnd(12)} ${describeField(f)}`);
	}
	return 0;
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
