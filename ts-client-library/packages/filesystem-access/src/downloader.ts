import { FileMeta } from "./filemeta"

export interface Downloader {
	readonly public: boolean

	getLocation(): Promise<Uint8Array>
	getEncryptionKey(): Promise<Uint8Array | undefined>

	readonly cancelled: boolean
	readonly errored: boolean
	readonly started: boolean
	readonly done: boolean
	readonly paused: boolean

	readonly name: string

	readonly size: number | undefined
	readonly sizeOnFS: number | undefined

	getDownloadUrl(): Promise<string | undefined>
	getMetadata(): Promise<FileMeta | undefined>

	readonly output: ReadableStream<Uint8Array> | undefined

	readonly startTime: number | undefined
	readonly endTime: number | undefined
	readonly pauseDuration: number

	_beforeDownload?: (d: this) => Promise<void>
	_afterDownload?: (d: this) => Promise<void>

	pause(): Promise<void>
	unpause(): Promise<void>

	start(): Promise<ReadableStream<Uint8Array> | undefined>
	finish(): Promise<void>

	cancel(): Promise<void>
}
