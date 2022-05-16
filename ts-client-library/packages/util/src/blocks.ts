export const blockSize = 64 * 1024
export const blockOverhead = 32
export const blockSizeOnFS = blockSize + blockOverhead

export const numberOfBlocks = (size: number) => {
	return Math.ceil(size / blockSize)
}

export const numberOfBlocksOnFS = (sizeOnFS: number) => {
	return Math.ceil(sizeOnFS / blockSizeOnFS)
}

export const sizeOnFS = (size: number) => {
	return size + blockOverhead * numberOfBlocks(size)
}
