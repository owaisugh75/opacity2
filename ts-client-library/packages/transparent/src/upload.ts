import { Mutex } from "async-mutex"

import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { extractPromise } from "@opacity/util/src/promise"
import { FileMeta } from "@opacity/filesystem-access/src/filemeta"
import { getPayload, getPayloadFD } from "@opacity/util/src/payload"
import {
	ITransparentUploadEvents,
	TransparentUploadPartFinishedEvent,
	TransparentUploadPartStartedEvent,
} from "./events"
import {
	IUploadEvents,
	UploadFinishedEvent,
	UploadMetadataEvent,
	UploadProgressEvent,
	UploadStartedEvent,
} from "@opacity/filesystem-access/src/events"
import { numberOfParts, partSize } from "@opacity/util/src/parts"
import { OQ } from "@opacity/util/src/oqueue"
import { Retry } from "@opacity/util/src/retry"
import { TransformStream, WritableStream, Uint8ArrayChunkStream } from "@opacity/util/src/streams"
import { Uploader } from "@opacity/filesystem-access/src/uploader"

export type TransparentUploadConfig = {
	storageNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware

	queueSize?: {
		net?: number
	}
}

export type TransparentUploadArgs = {
	config: TransparentUploadConfig
	path: string
	name: string
	meta: FileMeta
}

type UploadInitPayload = {
	fileHandle: string
	fileSizeInByte: number
	endIndex: number
}

type UploadInitExtraPayload = {
	metadata: Uint8Array
}

type UploadPayload = {
	fileHandle: string
	partIndex: number
	endIndex: number
}

type UploadExtraPayload = {
	chunkData: Uint8Array
}

type UploadStatusPayload = {
	fileHandle: string
}

export class TransparentUpload extends EventTarget implements Uploader, IUploadEvents, ITransparentUploadEvents {
	readonly public = true

	config: TransparentUploadConfig

	_m = new Mutex()

	_location?: Uint8Array
	_encryptionKey?: Uint8Array

	_locationExtractedPromise = extractPromise<Uint8Array>()
	_encryptionKeyExtractedPromise = extractPromise<Uint8Array>()

	private async _generateKeys () {
		if (this._location && this._encryptionKey) {
			return
		}

		await this._m.runExclusive(async () => {
			if (this._location && this._encryptionKey) {
				return
			}

			this._location = await this.config.crypto.getRandomValues(32)
			this._encryptionKey = await this.config.crypto.generateSymmetricKey()

			this._locationExtractedPromise[1](this._location)
			this._encryptionKeyExtractedPromise[1](this._encryptionKey)
		})
	}

	async getLocation (): Promise<Uint8Array> {
		await this._generateKeys()

		return await this._locationExtractedPromise[0]
	}

	async getEncryptionKey (): Promise<Uint8Array> {
		await this._generateKeys()

		return await this._encryptionKeyExtractedPromise[0]
	}

	_cancelled = false
	_errored = false
	_started = false
	_done = false
	_paused = false

	get cancelled () {
		return this._cancelled
	}
	get errored () {
		return this._errored
	}
	get started () {
		return this._started
	}
	get done () {
		return this._done
	}
	get paused () {
		return this._paused
	}

	_unpaused = Promise.resolve()
	_unpause?: (value: void) => void

	_finished: Promise<void>
	_resolve: (value?: void) => void
	_reject: (reason?: any) => void

	_size: number
	_sizeOnFS: number
	_numberOfParts: number

	get size () {
		return this._size
	}
	get sizeOnFS () {
		return this._sizeOnFS
	}

	_name: string
	_path: string
	_metadata: FileMeta

	get name () {
		return this._name
	}
	get path () {
		return this._path
	}
	get metadata () {
		return this._metadata
	}

	_netQueue?: OQ<Uint8Array>

	_output?: TransformStream<Uint8Array, Uint8Array>

	get output () {
		return this._output
	}

	_timestamps: { start?: number; end?: number; pauseDuration: number } = {
		start: undefined,
		end: undefined,
		pauseDuration: 0,
	}

	get startTime () {
		return this._timestamps.start
	}
	get endTime () {
		return this._timestamps.end
	}
	get pauseDuration () {
		return this._timestamps.pauseDuration
	}

	_beforeUpload?: (u: Uploader) => Promise<void>
	_afterUpload?: (u: Uploader) => Promise<void>

	async pause () {
		if (this._paused) {
			return
		}

		const t = Date.now()

		const [unpaused, unpause] = extractPromise()
		this._unpaused = unpaused
		this._unpause = () => {
			this._timestamps.pauseDuration += Date.now() - t
			unpause()
		}
		this._paused = true
	}

	async unpause () {
		if (this._unpause) {
			this._unpause()
			this._unpause = undefined
			this._paused = false
		}
	}

	constructor ({ config, name, path, meta }: TransparentUploadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.net = this.config.queueSize.net || 1

		this._name = name
		this._path = path
		this._metadata = meta

		this._size = this._metadata.size
		this._sizeOnFS = this._size
		this._numberOfParts = numberOfParts(this._size)

		const u = this

		const [finished, resolveFinished, rejectFinished] = extractPromise()
		this._finished = finished
		this._resolve = (val) => {
			u._done = true
			resolveFinished(val)

			this._timestamps.end = Date.now()
			this.dispatchEvent(
				new UploadFinishedEvent({
					start: this._timestamps.start!,
					end: this._timestamps.end,
					duration: this._timestamps.end - this._timestamps.start! - this._timestamps.pauseDuration,
					realDuration: this._timestamps.end - this._timestamps.start!,
				}),
			)
		}
		this._reject = (err) => {
			u._errored = true

			u.pause()

			rejectFinished(err)
		}
	}

	async start (): Promise<TransformStream<Uint8Array, Uint8Array> | undefined> {
		if (this._cancelled || this._errored) {
			return
		}

		if (this._started) {
			return this._output
		}

		this._started = true
		this._timestamps.start = Date.now()

		const ping = await this.config.net
			.GET(this.config.storageNode + "", undefined, undefined, async (d) =>
				new TextDecoder("utf8").decode(await new Response(d).arrayBuffer()),
			)
			.catch(this._reject)

		// server didn't respond
		if (!ping) {
			return
		}

		this.dispatchEvent(new UploadMetadataEvent({ metadata: this._metadata }))

		const u = this

		if (this._beforeUpload) {
			await this._beforeUpload(u).catch(u._reject)
		}

		const fd = await getPayloadFD<UploadInitPayload, UploadInitExtraPayload>({
			crypto: u.config.crypto,
			payload: {
				fileHandle: bytesToHex(await u.getLocation()),
				fileSizeInByte: u._size,
				endIndex: numberOfParts(u._size),
			},
			extraPayload: {
				metadata: new TextEncoder().encode(
					JSON.stringify(
						JSON.stringify({
							lastModified: u._metadata.lastModified,
							size: u._metadata.size,
							type: u._metadata.type,
						} as FileMeta),
					),
				),
			},
		})

		await u.config.net.POST(u.config.storageNode + "/api/v2/init-upload-public", {}, fd).catch(u._reject)

		u.dispatchEvent(
			new UploadStartedEvent({
				time: this._timestamps.start,
			}),
		)

		const netQueue = new OQ<Uint8Array | undefined>(this.config.queueSize!.net)

		u._netQueue = netQueue

		let partIndex = 0

		const partCollector = new Uint8ArrayChunkStream(
			partSize,
			new ByteLengthQueuingStrategy({ highWaterMark: this.config.queueSize!.net! * partSize + 1 }),
			new ByteLengthQueuingStrategy({ highWaterMark: this.config.queueSize!.net! * partSize + 1 }),
		)

		u._output = new TransformStream<Uint8Array, Uint8Array>(
			{
				transform (chunk, controller) {
					controller.enqueue(chunk)
				},
			},
			new ByteLengthQueuingStrategy({ highWaterMark: this.config.queueSize!.net! * partSize + 1 }),
		) as TransformStream<Uint8Array, Uint8Array>

		u._output.readable.pipeThrough(partCollector).pipeTo(
			new WritableStream<Uint8Array>({
				async write (part) {
					// console.log("write part")

					u.dispatchEvent(new TransparentUploadPartStartedEvent({ index: partIndex }))

					const p = new Uint8Array(part.length)

					netQueue.add(
						partIndex++,
						async (partIndex) => {
							if (u._cancelled || u._errored) {
								return
							}

							const res = await new Retry(
								async () => {
									const fd = await getPayloadFD<UploadPayload, UploadExtraPayload>({
										crypto: u.config.crypto,
										payload: {
											fileHandle: bytesToHex(await u.getLocation()),
											partIndex: partIndex + 1,
											endIndex: u._numberOfParts,
										},
										extraPayload: {
											chunkData: p,
										},
									})

									return await u.config.net.POST(u.config.storageNode + "/api/v2/upload-public", {}, fd)
								},
								{
									firstTimer: 500,
									handler: (err) => {
										console.warn(err)

										return false
									},
								},
							)
								.start()
								.catch(u._reject)

							if (!res) {
								return
							}

							// console.log(res)

							u.dispatchEvent(new TransparentUploadPartFinishedEvent({ index: partIndex }))
							u.dispatchEvent(new UploadProgressEvent({ progress: partIndex / u._numberOfParts }))

							return p
						},
						async (part, partIndex) => {
							if (!part) {
								return
							}
						},
					)
				},
				async close () {
					await netQueue.waitForClose()
				},
			}) as WritableStream<Uint8Array>,
		)

		netQueue.add(
			u._numberOfParts,
			() => {},
			async () => {
				const data = await getPayload<UploadStatusPayload>({
					crypto: u.config.crypto,
					payload: {
						fileHandle: bytesToHex(await u.getLocation()),
					},
				})

				const res = await u.config.net
					.POST(u.config.storageNode + "/api/v2/upload-status-public", {}, JSON.stringify(data))
					.catch(u._reject)

				// console.log(res)

				netQueue.close()
			},
		)

		netQueue.waitForClose().then(async () => {
			if (this._afterUpload) {
				await this._afterUpload(u).catch(u._reject)
			}

			u._resolve()
		})

		return u._output
	}

	async finish () {
		return this._finished
	}

	async cancel () {
		this._cancelled = true
		this._reject()
	}
}
