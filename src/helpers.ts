// Assign a CSS class based on a rule's category ID
export function categoryCssClass(categoryId: string): string {
	switch (categoryId) {
		case 'COLLOQUIALISMS':
		case 'REDUNDANCY':
		case 'STYLE':
		case 'SYNONYMS':
			return 'lt-style';
		case 'PUNCTUATION':
		case 'TYPOS':
			return 'lt-major';
	}

	return 'lt-minor';
}

export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
	let difference = new Set(setA)
	for (let elem of setB) {
		difference.delete(elem)
	}
	return difference
}
export function setUnion<T>(setA: Set<T>, setB: Set<T>): Set<T> {
	let union = new Set(setA)
	for (let elem of setB) {
		union.add(elem)
	}
	return union
}
export function setIntersect<T>(setA: Set<T>, setB: Set<T>): Set<T> {
	let intersection = new Set<T>()
	for (let elem of setB) {
		if (setA.has(elem)) {
			intersection.add(elem)
		}
	}
	return intersection
}

export function cmpIgnoreCase(a: string, b: string): -1 | 0 | 1 {
	a = a.toLowerCase();
	b = b.toLowerCase();
	return a > b ? 1 : (a < b ? -1 : 0);
}
