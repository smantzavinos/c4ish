// `c4ish view`: serve the built offline viewer, feed it one model (+ profile) from disk and
// live-reload it when either file changes. Dependency-free: node:http + fs.watch + server-sent events.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = '/__c4ish';
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8'
};

export interface ViewOptions {
	file: string;
	/** Explicit --profile; otherwise the model's own "profile" path is followed on every request. */
	profile?: string;
	tour?: string | true;
	step?: string;
	port?: number;
	open?: boolean;
	rebuild?: boolean;
	/** Called after each file change (the CLI re-validates and prints a summary). */
	onChange?: () => void;
}

/** The package root (the directory holding c4ish's package.json), from this file's location. */
function packageRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6; i++) {
		const pj = join(dir, 'package.json');
		if (existsSync(pj) && JSON.parse(readFileSync(pj, 'utf8')).name === 'c4ish') return dir;
		dir = dirname(dir);
	}
	throw new Error('cannot locate the c4ish package root');
}

/** The static viewer build: C4ISH_VIEWER_DIR, else <package>/build, built on demand in a source checkout. */
export function viewerRoot(rebuild = false): string {
	const env = process.env.C4ISH_VIEWER_DIR;
	if (env) return resolve(env);
	const root = packageRoot();
	const build = join(root, 'build');
	const has = existsSync(join(build, 'viewer', 'index.html'));
	if (has && !rebuild) return build;
	if (!existsSync(join(root, 'vite.config.ts'))) throw new Error(`no viewer build at ${build} (set C4ISH_VIEWER_DIR)`);
	console.error(has ? 'rebuilding the viewer…' : 'viewer not built yet — building it once (vite build)…');
	execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
	return build;
}

function profilePathOf(file: string, explicit?: string): string | undefined {
	if (explicit) return resolve(explicit);
	try {
		const p = (JSON.parse(readFileSync(file, 'utf8')) as { profile?: unknown }).profile;
		return typeof p === 'string' ? resolve(dirname(file), p) : undefined;
	} catch {
		return undefined;
	}
}

/** Viewer URL path (after the origin) that loads the served model and starts a tour if asked. */
export function viewerPath(o: { name: string; profile: boolean; tour?: string; step?: string }): string {
	const q = new URLSearchParams({ src: `${API}/model.json` });
	if (o.profile) q.set('profile', `${API}/profile.json`);
	q.set('live', `${API}/events`);
	q.set('name', o.name);
	const h = new URLSearchParams();
	if (o.tour) h.set('tour', o.tour);
	if (o.step) h.set('step', o.step);
	return `/viewer/?${q}${h.size ? `#${h}` : ''}`;
}

function openBrowser(url: string) {
	const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
	try {
		spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => console.error(`open ${url} in a browser`)).unref();
	} catch {
		console.error(`open ${url} in a browser`);
	}
}

export async function serveViewer(o: ViewOptions): Promise<{ url: string; close: () => void }> {
	const file = resolve(o.file);
	const root = viewerRoot(o.rebuild);
	const clients = new Set<ServerResponse>();

	const sendFile = (res: ServerResponse, path: string | undefined, type?: string) => {
		if (!path || !existsSync(path) || !statSync(path).isFile()) {
			res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
			return;
		}
		res.writeHead(200, { 'content-type': type ?? MIME[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
		res.end(readFileSync(path));
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const p = decodeURIComponent(url.pathname);
		if (p === `${API}/model.json`) return sendFile(res, file, MIME['.json']);
		if (p === `${API}/profile.json`) return sendFile(res, profilePathOf(file, o.profile), MIME['.json']);
		if (p === `${API}/events`) {
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
			res.write('retry: 1000\n\n');
			clients.add(res);
			req.on('close', () => clients.delete(res));
			return;
		}
		if (p === '/') {
			res.writeHead(302, { location: start }).end();
			return;
		}
		const target = normalize(join(root, p));
		if (target !== root && !target.startsWith(root + sep)) {
			res.writeHead(403).end();
			return;
		}
		sendFile(res, existsSync(target) && statSync(target).isDirectory() ? join(target, 'index.html') : target);
	});

	// watch directories, not files: editors often replace a file on save
	let timer: ReturnType<typeof setTimeout> | undefined;
	const watchers: FSWatcher[] = [];
	const watchFor = (path: string) => {
		try {
			watchers.push(
				watch(dirname(path), (_e, name) => {
					const files = new Set([basename(file), ...[profilePathOf(file, o.profile)].filter((x): x is string => !!x).map((x) => basename(x))]);
					if (name && !files.has(name.toString())) return;
					clearTimeout(timer);
					timer = setTimeout(() => {
						o.onChange?.();
						for (const c of clients) c.write(`event: change\ndata: ${Date.now()}\n\n`);
					}, 120);
				})
			);
		} catch {
			console.error(`warning: cannot watch ${dirname(path)}; live reload is off for it`);
		}
	};
	const profile = profilePathOf(file, o.profile);
	watchFor(file);
	if (profile && dirname(profile) !== dirname(file)) watchFor(profile);
	const keepAlive = setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 25_000);

	let tour = typeof o.tour === 'string' ? o.tour : undefined;
	if (o.tour === true || (!tour && o.step)) {
		try {
			tour = (JSON.parse(readFileSync(file, 'utf8')) as { tours?: { id: string }[] }).tours?.[0]?.id;
		} catch {
			/* the viewer reports the parse error */
		}
		if (!tour) console.error('warning: the model has no tours; opening without one');
	}
	const start = viewerPath({ name: basename(file), profile: !!profile, tour, step: tour ? o.step : undefined });

	let port = o.port ?? 4319;
	for (let attempt = 0; ; attempt++) {
		try {
			await new Promise<void>((ok, fail) => {
				server.once('error', fail);
				server.listen(port, '127.0.0.1', () => {
					server.off('error', fail);
					ok();
				});
			});
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || o.port !== undefined || attempt > 10) throw e;
			port++;
		}
	}
	port = (server.address() as AddressInfo).port;
	const url = `http://localhost:${port}${start}`;
	if (o.open !== false) openBrowser(url);
	return {
		url,
		close: () => {
			clearInterval(keepAlive);
			watchers.forEach((w) => w.close());
			clients.forEach((c) => c.end());
			server.close();
		}
	};
}
