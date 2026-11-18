type FieldType = 'id' | 'string' | 'number';

/** A minimal stand-in for a database library's table builder. */
export function table<F extends Record<string, FieldType>>(fields: F) {
	const indexes: Record<string, (keyof F)[]> = {};
	const self = {
		fields,
		indexes,
		index(name: string, on: (keyof F)[]) {
			indexes[name] = on;
			return self;
		}
	};
	return self;
}
