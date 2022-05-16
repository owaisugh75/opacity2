import { Mutex } from "async-mutex"
import { blockSize, blockSizeOnFS, numberOfBlocks, sizeOnFS } from "@opacity/util/src/blocks"
import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { extractPromise } from "@opacity/util/src/promise"
import { FileMeta } from "@opacity/filesystem-access/src/filemeta"
import { getPayload, getPayloadFD } from "@opacity/util/src/payload"
import {
	IOpaqueUploadEvents,
	OpaqueUploadBlockFinishedEvent,
	OpaqueUploadBlockStartedEvent,
	OpaqueUploadPartFinishedEvent,
	OpaqueUploadPartStartedEvent,
} from "./events"
import {
	IUploadEvents,
	UploadFinishedEvent,
	UploadErrorEvent,
	UploadCancelEvent,
	UploadMetadataEvent,
	UploadProgressEvent,
	UploadStartedEvent,
} from "@opacity/filesystem-access/src/events"
import { numberOfPartsOnFS, partSize } from "@opacity/util/src/parts"
import { OQ } from "@opacity/util/src/oqueue"
import { Retry } from "@opacity/util/src/retry"
import { TransformStream, WritableStream, Uint8ArrayChunkStream } from "@opacity/util/src/streams"
import { Uploader } from "@opacity/filesystem-access/src/uploader"

export type OpaqueUploadConfig = {
	storageNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware

	queueSize?: {
		encrypt?: number
		net?: number
	}
}

export type OpaqueUploadArgs = {
	config: OpaqueUploadConfig
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

export class OpaqueUpload extends EventTarget implements Uploader, IUploadEvents, IOpaqueUploadEvents {
	readonly public = false

	config: OpaqueUploadConfig

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
	_cancel: (reason?: any) => void

	_size: number
	_sizeOnFS: number
	_numberOfBlocks: number
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

	_uploaderId: string
	
	get uploaderId () {
		return this._uploaderId
	}
	_netQueue?: OQ<Uint8Array>
	_encryptQueue?: OQ<Uint8Array>

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
	_afterUpload?: (uploaderId: string) => Promise<void>
	_cancelUpload?: (uploaderId: string) => Promise<boolean>

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

	constructor ({ config, name, path, meta }: OpaqueUploadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.encrypt = this.config.queueSize.encrypt || 3
		this.config.queueSize.net = this.config.queueSize.net || 1

		this._name = name
		this._path = path
		this._metadata = meta
		this._uploaderId = meta.size + name + path
		this._size = this._metadata.size
		this._sizeOnFS = sizeOnFS(this._size)
		this._numberOfBlocks = numberOfBlocks(this._size)
		this._numberOfParts = numberOfPartsOnFS(this._sizeOnFS)

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
		this._cancel = (err) => {
			u._cancelled = true

			u.pause()

			rejectFinished(err)
			this._timestamps.end = Date.now()

			this.dispatchEvent(
				new UploadCancelEvent({
					start: this._timestamps.start!,
					end: this._timestamps.end,
				}),
			)

		}
		this._reject = (err) => {
			u._errored = true

			u.pause()

			rejectFinished(err)
			this._timestamps.end = Date.now()

			this.dispatchEvent(
				new UploadErrorEvent({
					start: this._timestamps.start!,
					end: this._timestamps.end,
					error: err
				}),
			)

			throw new Error("Error uploading");
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

		this.dispatchEvent(new UploadMetadataEvent({ metadata: this._metadata }))

		const u = this
		if (this._cancelled || this._errored) {
			return
		}
		if (this._beforeUpload) {
			await this._beforeUpload(u).catch(u._reject)
		}

		const encryptedMeta = await u.config.crypto.encrypt(
			await u.getEncryptionKey(),
			new TextEncoder().encode(
				JSON.stringify({
					lastModified: u._metadata.lastModified,
					size: u._metadata.size,
					type: u._metadata.type,
				} as FileMeta),
			),
		)
		if (this._cancelled || this._errored) {
			return
		}
		const fd = await getPayloadFD<UploadInitPayload, UploadInitExtraPayload>({
			crypto: u.config.crypto,
			payload: {
				fileHandle: bytesToHex(await u.getLocation()),
				fileSizeInByte: u._sizeOnFS,
				endIndex: numberOfPartsOnFS(u._sizeOnFS),
			},
			extraPayload: {
				metadata: encryptedMeta,
			},
		})
		if (this._cancelled || this._errored) {
			return
		}
		const resInitUpload = await u.config.net.POST(u.config.storageNode + "/api/v1/init-upload", {}, fd).catch(e => u._reject("Failed init file on upload!"))
		
		if (!resInitUpload.ok) {
			u._reject("Failed init file on upload: " + JSON.stringify(resInitUpload.data))
		}

		u.dispatchEvent(
			new UploadStartedEvent({
				time: this._timestamps.start,
			}),
		)

		const encryptQueue = new OQ<Uint8Array | undefined>(this.config.queueSize!.encrypt, Number.MAX_SAFE_INTEGER)
		const netQueue = new OQ<Uint8Array | undefined>(this.config.queueSize!.net)

		u._encryptQueue = encryptQueue
		u._netQueue = netQueue

		let blockIndex = 0
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

					u.dispatchEvent(new OpaqueUploadPartStartedEvent({ index: partIndex }))

					const p = new Uint8Array(sizeOnFS(part.length))

					netQueue.add(
						partIndex++,
						async (partIndex) => {
							if (u._cancelled || u._errored) {
								return
							}

							for (let i = 0; i < numberOfBlocks(part.length); i++) {
								const block = part.slice(i * blockSize, (i + 1) * blockSize)

								encryptQueue.add(
									blockIndex++,
									async (blockIndex) => {
										if (u._cancelled || u._errored) {
											return
										}

										u.dispatchEvent(new OpaqueUploadBlockStartedEvent({ index: blockIndex }))

										return await u.config.crypto.encrypt(await u.getEncryptionKey(), block)
									},
									async (encrypted, blockIndex) => {
										// console.log("write encrypted")

										if (!encrypted) {
											return
										}

										let byteIndex = 0
										for (let byte of encrypted) {
											p[i * blockSizeOnFS + byteIndex] = byte
											byteIndex++
										}

										u.dispatchEvent(new OpaqueUploadBlockFinishedEvent({ index: blockIndex }))
										if (u._cancelled || u._errored) {
											return
										}
										u.dispatchEvent(new UploadProgressEvent({ progress: blockIndex / u._numberOfBlocks }))
									},
								)
							}

							await encryptQueue.waitForCommit(blockIndex - 1)
							if (u._cancelled || u._errored) {
								return
							}
							const res = await new Retry(
								async () => {
									if (u._cancelled || u._errored) {
										return
									}
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

									return await u.config.net.POST(u.config.storageNode + "/api/v1/upload", {}, fd)
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
								.catch(e => u._reject("Failed upload chunk"))

							if (!res) {
								return
							}

							// console.log(res)

							u.dispatchEvent(new OpaqueUploadPartFinishedEvent({ index: partIndex }))

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
					await encryptQueue.waitForClose()
				},
			}) as WritableStream<Uint8Array>,
		)

		if (u._cancelled || u._errored) {
			return
		}

		encryptQueue.add(
			numberOfBlocks(u._size),
			() => {},
			async () => {
				encryptQueue.close()
			},
		)

		if (u._cancelled || u._errored) {
			return
		}
		
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
				if (this._cancelled || this._errored) {
					return
				}
				const resUploadStatus = await u.config.net
					.POST(u.config.storageNode + "/api/v1/upload-status", {}, JSON.stringify(data))
					.catch(e => u._reject("Failed upload status"))
				
				if (!resUploadStatus.ok) {
					u._reject("Failed upload status: " + JSON.stringify(resUploadStatus.data))
				}


				netQueue.close()
			},
		)

		if (u._cancelled || u._errored) {
			return
		}

		Promise.all([encryptQueue.waitForClose(), netQueue.waitForClose()]).then(async () => {
			if (this._afterUpload) {
				if (u._cancelled || u._errored) {
					return
				}
				await this._afterUpload(this.uploaderId).catch(u._reject).then(res => {
					if(res === null) {
						u._cancel()
					} else {
						u._resolve()
					}
				})
			}

		})

		return u._output
	}

	async finish () {
		return this._finished
	}

	async cancel (): Promise<boolean>  {
		if (this._cancelUpload) {
			if(this._cancelUpload(this.uploaderId)) {
				this._cancel()
				return true
			}
		}
		return false
	}
}
