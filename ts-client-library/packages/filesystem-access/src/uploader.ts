import { FileMeta } from "./filemeta"

export interface Uploader {
	readonly public: boolean

	getLocation(): Promise<Uint8Array>
	getEncryptionKey(): Promise<Uint8Array | undefined>

	readonly cancelled: boolean
	readonly errored: boolean
	readonly started: boolean
	readonly done: boolean
	readonly paused: boolean

	readonly name: string
	readonly path: string
	readonly metadata: FileMeta

	readonly size: number
	readonly sizeOnFS: number

	readonly output: TransformStream<Uint8Array, Uint8Array> | undefined

	readonly startTime: number | undefined
	readonly endTime: number | undefined
	readonly pauseDuration: number
	readonly uploaderId: string

	_beforeUpload?: (u: this) => Promise<void>
	_afterUpload?: (uploaderId: string) => Promise<void>
	_cancelUpload?: (uploaderId: string) => Promise<boolean>

	pause(): Promise<void>
	unpause(): Promise<void>

	start(): Promise<TransformStream<Uint8Array, Uint8Array> | undefined>
	finish(): Promise<void>

	cancel(): Promise<boolean>
}
