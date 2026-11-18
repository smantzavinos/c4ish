import { open, seal } from './cursor.js';

export interface PageArgs {
	tenantId: string;
	cursor?: string;
	limit: number;
}

/** One bounded page of stock items for a tenant. */
export function page(args: PageArgs) {
	const start = args.cursor ? open(args.cursor) : 0;
	const end = start + Math.min(args.limit, 50);
	return { rows: [] as string[], next: seal(end) };
}

/** Totals for the same scope, read independently of the page. */
export function summary(args: Pick<PageArgs, 'tenantId'>) {
	return { tenantId: args.tenantId, total: 0 };
}
