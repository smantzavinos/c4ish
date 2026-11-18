/** Seals a page position so a client cannot forge or edit it. */
export function seal(position: number): string {
	return `sealed:${position}`;
}

/** Opens a sealed position; rejects anything this server did not seal. */
export function open(cursor: string): number {
	if (!cursor.startsWith('sealed:')) throw new Error('not a sealed cursor');
	return Number(cursor.slice('sealed:'.length));
}
