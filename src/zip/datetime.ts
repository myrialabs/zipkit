/** MS-DOS date/time <-> JS Date, as stored in ZIP local/central headers. */

/** Encode a Date to a packed DOS date and time pair (`{ date, time }`). */
export function toDosDateTime(d: Date): { date: number; time: number } {
	const year = Math.max(1980, d.getFullYear());
	const date = (((year - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
	return { date, time };
}

/** Decode a packed DOS date/time pair back to a Date. */
export function fromDosDateTime(date: number, time: number): Date {
	return new Date(
		((date >> 9) & 0x7f) + 1980,
		((date >> 5) & 0x0f) - 1,
		date & 0x1f,
		(time >> 11) & 0x1f,
		(time >> 5) & 0x3f,
		(time & 0x1f) << 1
	);
}
