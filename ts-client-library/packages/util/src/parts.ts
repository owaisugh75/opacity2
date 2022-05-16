import { blockSizeOnFS, blockSize } from "./blocks"

export const blocksPerPart = 80
export const threadCount = 5
export const partSize = blocksPerPart * blockSize
export const threadPartSize = partSize * threadCount
export const partSizeOnFS = blocksPerPart * blockSizeOnFS

export const numberOfParts = (size: number) => {
	return Math.ceil(size / partSize)
}

export const numberOfThread = (size: number) => {
	return Math.ceil(size / partSize)
}

export const numberOfPartsOnFS = (sizeOnFS: number) => {
	return Math.ceil(sizeOnFS / partSizeOnFS)
}
