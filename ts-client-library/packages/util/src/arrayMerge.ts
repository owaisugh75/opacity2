export type ArrayLikeWritable<T> = {
	readonly length: number
	[n: number]: T
}

export const arrayMerge = <T extends ArrayLikeWritable<unknown>>(...arr: T[]) => {
	if (arr.length == 0) {
		return ([] as unknown) as T
	}

	const l = arr.reduce((acc, cur) => acc + cur.length, 0)

	const out: typeof arr[ 0 ] = new (arr[0].constructor as any)(l) as T

	let i = 0
	for (let a of arr) {
		for (let j = 0; j < a.length; j++) {
			out[i] = a[j]
			i++
		}
	}

	return out
}
