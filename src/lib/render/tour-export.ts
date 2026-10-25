import type { Model, Profile, Tour } from '../model/types.js';
import { narrationHtml, narrationText, stepFilter, tourHash } from '../viewer/tour.js';
import { renderView } from './page.js';

/**
 * Static export of a tour (DECISIONS 26): one SVG per step plus an offline slideshow and a
 * markdown listing. Pure — the CLI writes the files.
 */
export interface TourExport {
	steps: { file: string; id: string; title: string; svg: string; width: number; height: number }[];
	html: string;
	markdown: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function exportTour(model: Model, profile: Profile, tour: Tour): Promise<TourExport> {
	const steps: TourExport['steps'] = [];
	const total = tour.steps.length;
	for (const [i, step] of tour.steps.entries()) {
		const res = await renderView(model, profile, {
			view: step.view,
			idPrefix: `t${i + 1}-`,
			tour: { tourTitle: tour.title, stepTitle: step.title, body: narrationText(step.body), index: i + 1, total, filter: stepFilter(model, profile, step) }
		});
		const file = `${String(i + 1).padStart(2, '0')}-${step.id.replace(/[^A-Za-z0-9_-]+/g, '-')}.svg`;
		steps.push({ file, id: step.id, title: step.title, svg: res.svg, width: res.width, height: res.height });
	}

	const markdown =
		`# ${tour.title}\n\n` +
		(tour.summary ? `${tour.summary}\n\n` : '') +
		tour.steps
			.map((s, i) => {
				const f = steps[i].file;
				const view = model.views.find((v) => v.id === s.view)?.title ?? s.view;
				return `## ${i + 1}. ${s.title}\n\n*View: ${view}* · viewer link: \`${tourHash(tour.id, s.id)}\`\n\n${s.body ?? ''}\n\n![${s.title}](${f})\n`;
			})
			.join('\n');

	const slides = tour.steps
		.map(
			(s, i) =>
				`<section data-step="${esc(s.id)}"><header><span class="n">${i + 1} / ${total}</span><h2>${esc(s.title)}</h2>${narrationHtml(s.body)}</header>` +
				`<img src="${esc(steps[i].file)}" alt="${esc(s.title)}" width="${steps[i].width}" height="${steps[i].height}"></section>`
		)
		.join('\n');
	const list = tour.steps.map((s, i) => `<li><a href="#${esc(s.id)}">${i + 1}. ${esc(s.title)}</a></li>`).join('');
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tour.title)}</title>
<style>
body{margin:0;font:14px/1.5 'Noto Sans',system-ui,sans-serif;color:#0f172a;display:flex;height:100vh}
nav{width:250px;flex:none;border-right:1px solid #e2e8f0;padding:16px;overflow:auto;background:#f8fafc}
nav h1{font-size:15px;margin:0 0 6px}nav p{color:#64748b;font-size:12.5px;margin:0 0 12px}
nav ol{padding-left:0;list-style:none;margin:0}nav a{display:block;padding:4px 8px;border-radius:4px;color:#334155;text-decoration:none;font-size:13px}
nav a.on{background:#2563eb;color:#fff}
main{flex:1;overflow:auto;padding:16px 24px}
section{display:none}section.on{display:block}
header{max-width:900px;border-left:4px solid #2563eb;background:#eff6ff;padding:8px 14px;margin-bottom:12px}
header h2{margin:0 0 4px;font-size:18px}header p{margin:4px 0}.n{color:#2563eb;font-weight:700;font-size:12px;letter-spacing:.08em}
img{max-width:100%;height:auto;border:1px solid #e2e8f0}
.keys{color:#94a3b8;font-size:12px;margin-top:12px}
</style></head><body>
<nav><h1>${esc(tour.title)}</h1>${tour.summary ? `<p>${esc(tour.summary)}</p>` : ''}<ol>${list}</ol><p class="keys">← / → to step</p></nav>
<main>
${slides}
</main>
<script>
const s=[...document.querySelectorAll('section')],a=[...document.querySelectorAll('nav a')];let i=0;
function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,k)=>x.classList.toggle('on',k===i));a.forEach((x,k)=>x.classList.toggle('on',k===i));history.replaceState(null,'','#'+s[i].dataset.step);document.querySelector('main').scrollTo(0,0)}
a.forEach((x,k)=>x.addEventListener('click',e=>{e.preventDefault();show(k)}));
addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')show(i+1);else if(e.key==='ArrowLeft')show(i-1)});
const h=s.findIndex(x=>'#'+x.dataset.step===location.hash);show(h<0?0:h);
</script></body></html>
`;
	return { steps, html, markdown };
}
