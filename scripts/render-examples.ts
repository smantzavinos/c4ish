// Validates and renders every examples/*/model.c4ish.json view to <dir>/<view>.svg (+ .png with --png),
// and exports each tour to <dir>/tour/ (one sub-directory per tour when there are several).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { check } from '../src/lib/api.js';
import { renderView } from '../src/lib/render/page.js';
import { exportTour } from '../src/lib/render/tour-export.js';

const png = process.argv.includes('--png');
let failed = false;
for (const dir of readdirSync('examples', { withFileTypes: true }).filter((d) => d.isDirectory())) {
	const file = join('examples', dir.name, 'model.c4ish.json');
	if (!existsSync(file)) continue;
	const modelJson = JSON.parse(readFileSync(file, 'utf8'));
	const profileJson = modelJson.profile ? JSON.parse(readFileSync(resolve(dirname(file), modelJson.profile), 'utf8')) : undefined;
	const res = check(modelJson, profileJson);
	for (const d of res.diagnostics) console.error(`${d.severity} ${file} [${d.at ?? ''}] ${d.message}`);
	if (!res.ok || !res.model || !res.profile) {
		failed = true;
		continue;
	}
	for (const v of res.model.views) {
		const out = join('examples', dir.name, `${v.id}.svg`);
		const r = await renderView(res.model, res.profile, { view: v.id });
		writeFileSync(out, r.svg);
		console.log(`wrote ${out} (${r.width}×${r.height})`);
		if (png) execFileSync('magick', ['-density', '110', '-background', 'white', out, out.replace(/\.svg$/, '.png')]);
	}
	const tours = res.model.tours ?? [];
	for (const tour of tours) {
		const tdir = join('examples', dir.name, 'tour', ...(tours.length > 1 ? [tour.id] : []));
		mkdirSync(tdir, { recursive: true });
		const ex = await exportTour(res.model, res.profile, tour);
		for (const st of ex.steps) {
			const out = join(tdir, st.file);
			writeFileSync(out, st.svg);
			if (png) execFileSync('magick', ['-density', '110', '-background', 'white', out, out.replace(/\.svg$/, '.png')]);
		}
		writeFileSync(join(tdir, 'index.html'), ex.html);
		writeFileSync(join(tdir, 'tour.md'), ex.markdown);
		console.log(`wrote ${tdir}/ (${ex.steps.length} steps)`);
	}
}
process.exit(failed ? 1 : 0);
