// Searching the options of the MultiSelect component.
export type MultiSelectOption = { value: string; label: string; hint?: string };

// Case and accents do not matter when searching: "mull" finds "Müller", "yilmaz" "Yılmaz".
export function searchKey(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replaceAll('ı', 'i')
		.replaceAll('ß', 'ss');
}

export function matchOptions(
	options: MultiSelectOption[],
	chosen: string[],
	query: string
): MultiSelectOption[] {
	const words = searchKey(query).split(/\s+/).filter(Boolean);
	return options.filter((option) => {
		if (chosen.includes(option.value)) return false;
		const key = searchKey(`${option.label} ${option.hint ?? ''}`);
		return words.every((word) => key.includes(word));
	});
}
