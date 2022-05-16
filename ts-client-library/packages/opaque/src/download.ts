import { Mutex } from "async-mutex"

import { blockSizeOnFS, numberOfBlocks, numberOfBlocksOnFS, sizeOnFS } from "@opacity/util/src/blocks"
import { blocksPerPart, numberOfPartsOnFS, partSizeOnFS } from "@opacity/util/src/parts"
import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { Downloader } from "@opacity/filesystem-access/src/downloader"
import {
	DownloadFinishedEvent,
	DownloadMetadataEvent,
	DownloadProgressEvent,
	DownloadStartedEvent,
	IDownloadEvents,
} from "@opacity/filesystem-access/src/events"
import { extractPromise } from "@opacity/util/src/promise"
import { FileMeta } from "@opacity/filesystem-access/src/filemeta"
import {
	IOpaqueDownloadEvents,
	OpaqueDownloadBlockFinishedEvent,
	OpaqueDownloadBlockStartedEvent,
	OpaqueDownloadPartFinishedEvent,
	OpaqueDownloadPartStartedEvent,
} from "./events"
import { OQ } from "@opacity/util/src/oqueue"
import {
	polyfillReadableStreamIfNeeded,
	ReadableStream,
	TransformStream,
	WritableStream,
} from "@opacity/util/src/streams"
import { serializeEncrypted } from "@opacity/util/src/serializeEncrypted"
import { Uint8ArrayChunkStream } from "@opacity/util/src/streams"
import { FileMetadata } from "@opacity/account-system/src"

export type OpaqueDownloadConfig = {
	storageNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware

	queueSize?: {
		net?: number
		decrypt?: number
	}
}

export type OpaqueDownloadArgs = {
	config: OpaqueDownloadConfig
	handle: Uint8Array
	name: string
	fileMeta: FileMetadata
}

export class OpaqueDownload extends EventTarget implements Downloader, IDownloadEvents, IOpaqueDownloadEvents {
	readonly public = false

	config: OpaqueDownloadConfig

	_m = new Mutex()

	_location = extractPromise<Uint8Array>()
	_encryptionKey = extractPromise<Uint8Array>()

	async getLocation (): Promise<Uint8Array> {
		return this._location[0]
	}

	async getEncryptionKey (): Promise<Uint8Array> {
		return this._encryptionKey[0]
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

	_name: string

	_fileMeta: FileMetadata

	get name () {
		return this._name
	}

	_size?: number
	_sizeOnFS?: number
	_numberOfBlocks?: number
	_numberOfParts?: number

	get size () {
		return this._size
	}
	get sizeOnFS () {
		return this._sizeOnFS
	}

	_downloadUrl?: string
	_metadata?: FileMeta

	_netQueue?: OQ<void>
	_decryptQueue?: OQ<Uint8Array>

	_output?: ReadableStream<Uint8Array>

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

	_beforeDownload?: (d: Downloader) => Promise<void>
	_afterDownload?: (d: Downloader) => Promise<void>

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

	constructor ({ config, handle, name, fileMeta }: OpaqueDownloadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.net = this.config.queueSize.net || 3
		this.config.queueSize.decrypt = this.config.queueSize.decrypt || blocksPerPart

		this._location[1](handle.slice(0, 32))
		this._encryptionKey[1](handle.slice(32))

		this._name = name

		this._fileMeta = fileMeta

		const d = this

		const [finished, resolveFinished, rejectFinished] = extractPromise()
		this._finished = finished
		this._resolve = (val) => {
			d._done = true
			resolveFinished(val)

			this._timestamps.end = Date.now()
			this.dispatchEvent(
				new DownloadFinishedEvent({
					start: this._timestamps.start!,
					end: this._timestamps.end,
					duration: this._timestamps.end - this._timestamps.start! - this._timestamps.pauseDuration,
					realDuration: this._timestamps.end - this._timestamps.start!,
				}),
			)
		}
		this._reject = (err) => {
			d._errored = true

			rejectFinished(err)
		}
	}

	async getDownloadUrl (): Promise<string | undefined> {
		return this._m.runExclusive(async () => {
			if (this._downloadUrl) {
				return this._downloadUrl
			}

			const d = this

			const downloadUrlRes = await d.config.net
				.POST(
					d.config.storageNode + "/api/v1/download",
					undefined,
					JSON.stringify({ fileID: bytesToHex(await d.getLocation()) }),
					async (b) => JSON.parse(new TextDecoder("utf8").decode(await new Response(b).arrayBuffer())).fileDownloadUrl,
				)
				.catch(d._reject)

			if (!downloadUrlRes) {
				return
			}

			const downloadUrl = downloadUrlRes.data + '/file'

			this._downloadUrl = downloadUrl

			return downloadUrl
		})
	}


	async getMetadata (): Promise<any> {
		return this._m.runExclusive(async () => {
			if (this._fileMeta) {
				return this._fileMeta
			}
			if (this._metadata) {
				return this._metadata
			}

			const d = this

			if (!this._downloadUrl) {
				await this.getDownloadUrl()
			}

			const metadataRes = await d.config.net
				.GET(
					this._downloadUrl + "/metadata",
					undefined,
					undefined,
					async (b) =>
						await serializeEncrypted<FileMeta>(
							d.config.crypto,
							new Uint8Array(await new Response(b).arrayBuffer()),
							await d.getEncryptionKey(),
						),
				)
				.catch(d._reject)

			if (!metadataRes) {
				return
			}

			const metadata = metadataRes.data
			// old uploads will not have this defined
			metadata.lastModified = metadata.lastModified || Date.now()
			d._metadata = metadata
			this.dispatchEvent(new DownloadMetadataEvent({ metadata }))

			return metadata
		})
	}

	async start (): Promise<ReadableStream<Uint8Array> | undefined> {
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

		const d = this

		if (this._beforeDownload) {
			await this._beforeDownload(d)
		}

		// let downloadUrl = await d.getDownloadUrl().catch(d._reject)
		// if (!downloadUrl) {
			let downloadUrl = await d.getDownloadUrl().catch(d._reject)
			if(!downloadUrl) {
				return
			}
		// }

		const metadata = await d.getMetadata().catch(d._reject)
		if (!metadata) {
			return
		}

		d._size = metadata.size
		d._sizeOnFS = sizeOnFS(metadata.size)
		d._numberOfBlocks = numberOfBlocks(d._size)
		d._numberOfParts = numberOfPartsOnFS(d._sizeOnFS)

		d.dispatchEvent(
			new DownloadStartedEvent({
				time: this._timestamps.start,
			}),
		)

		const netQueue = new OQ<void>(this.config.queueSize!.net)
		const decryptQueue = new OQ<Uint8Array | undefined>(this.config.queueSize!.decrypt)

		d._netQueue = netQueue
		d._decryptQueue = decryptQueue

		let partIndex = 0

		d._output = new ReadableStream<Uint8Array>({
			async pull (controller) {
				if (d._cancelled || d._errored) {
					return
				}

				if (partIndex >= d._numberOfParts!) {
					return
				}

				netQueue.add(
					partIndex++,
					async (partIndex) => {
						if (d._cancelled || d._errored) {
							return
						}

						await d._unpaused

						d.dispatchEvent(new OpaqueDownloadPartStartedEvent({ index: partIndex }))

						const res = await d.config.net
							.GET(
								downloadUrl + "",
								{
									range: `bytes=${partIndex * partSizeOnFS}-${
										Math.min(d._sizeOnFS!, (partIndex + 1) * partSizeOnFS) - 1
									}`,
								},
								undefined,
								async (rs) => (rs ? (polyfillReadableStreamIfNeeded(rs) as ReadableStream<Uint8Array>) : undefined),
							)
							.catch(d._reject)

						if (!res || !res.data) {
							return
						}

						let l = 0
						res.data
							.pipeThrough(
								new TransformStream<Uint8Array, Uint8Array>({
									// log progress
									transform (chunk, controller) {
										for (
											let i = Math.floor(l / blockSizeOnFS);
											i < Math.floor((l + chunk.length) / blockSizeOnFS);
											i++
										) {
											d.dispatchEvent(new OpaqueDownloadBlockStartedEvent({ index: partIndex * blocksPerPart + i }))
										}

										l += chunk.length

										controller.enqueue(chunk)
									},
								}) as ReadableWritablePair<Uint8Array, Uint8Array>,
							)
							.pipeThrough(new Uint8ArrayChunkStream(partSizeOnFS))
							.pipeTo(
								new WritableStream<Uint8Array>({
									async write (part) {
										for (let i = 0; i < numberOfBlocksOnFS(part.length); i++) {
											decryptQueue.add(
												partIndex * blocksPerPart + i,
												async (blockIndex) => {
													if (d._cancelled || d._errored) {
														return
													}

													let bi = blockIndex % blocksPerPart

													await d._unpaused

													const block = part.slice(bi * blockSizeOnFS, (bi + 1) * blockSizeOnFS)
													const decrypted = await d.config.crypto
														.decrypt(await d.getEncryptionKey(), block)
														.catch(d._reject)

													if (!decrypted) {
														return
													}

													return decrypted
												},
												async (decrypted, blockIndex) => {
													if (!decrypted) {
														return
													}

													controller.enqueue(decrypted)

													d.dispatchEvent(new OpaqueDownloadBlockFinishedEvent({ index: blockIndex }))
													d.dispatchEvent(new DownloadProgressEvent({ progress: blockIndex / d._numberOfBlocks! }))
												},
											)
										}
									},
								}) as WritableStream<Uint8Array>,
							)

						await decryptQueue.waitForCommit(Math.min((partIndex + 1) * blocksPerPart, d._numberOfBlocks!) - 1)

						d.dispatchEvent(new OpaqueDownloadPartFinishedEvent({ index: partIndex }))
					},
					() => {},
				)
			},
			async start (controller) {
				netQueue.add(
					d._numberOfParts!,
					() => {},
					async () => {
						netQueue.close()
					},
				)

				decryptQueue.add(
					numberOfBlocks(d._size!),
					() => {},
					async () => {
						decryptQueue.close()
					},
				)

				// the start function is blocking for pulls so this must not be awaited
				Promise.all([netQueue.waitForClose(), decryptQueue.waitForClose()]).then(async () => {
					if (d._afterDownload) {
						await d._afterDownload(d).catch(d._reject)
					}

					d._resolve()
					controller.close()
				})
			},
			cancel () {
				d._cancelled = true
			},
		}) as ReadableStream<Uint8Array>

		return d._output
	}

	async finish () {
		return this._finished
	}

	async cancel () {
		this._cancelled = true

		if (this._output) {
			this._output.cancel()
		}

		this._reject()
	}
}
