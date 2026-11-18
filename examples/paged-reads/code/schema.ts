// Sample code for the paged-reads example model. Its only job is to give the model's "code"
// references something to point at; `c4ish code examples/paged-reads/model.c4ish.json` resolves them.
import { table } from './table.js';

/** Fields every tenant-scoped row carries. */
const tenantFields = { tenantId: 'id' };

export const tables = {
	// One row per version of an item.
	stockItems: table({ ...tenantFields, sku: 'string', version: 'number', name: 'string', status: 'string' })
		.index('by_tenant_name', ['tenantId', 'name'])
		.index('by_tenant_status', ['tenantId', 'status'])
		.index('by_tenant_sku_version', ['tenantId', 'sku', 'version']),

	binPlacements: table({ level: 'string', targetId: 'id', itemId: 'id' })
};
