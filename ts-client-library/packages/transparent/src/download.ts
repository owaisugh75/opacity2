import { Mutex } from "async-mutex"

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
	ITransparentDownloadEvents,
	TransparentDownloadPartFinishedEvent,
	TransparentDownloadPartStartedEvent,
} from "./events"
import { numberOfParts, partSize } from "@opacity/util/src/parts"
import { OQ } from "@opacity/util/src/oqueue"
import { polyfillReadableStreamIfNeeded, ReadableStream, WritableStream } from "@opacity/util/src/streams"

export type TransparentDownloadConfig = {
	storageNode: string

	crypto: CryptoMiddleware
	net: NetworkMiddleware

	queueSize?: {
		net?: number
	}
}

export type TransparentDownloadArgs = {
	config: TransparentDownloadConfig
	location: Uint8Array
	name: string
}

export class TransparentDownload extends EventTarget
	implements Downloader, IDownloadEvents, ITransparentDownloadEvents {
	readonly public = true

	config: TransparentDownloadConfig

	_m = new Mutex()

	_location = extractPromise<Uint8Array>()
	_encryptionKey = extractPromise<undefined>()

	async getLocation (): Promise<Uint8Array> {
		return this._location[0]
	}

	async getEncryptionKey (): Promise<undefined> {
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

	get name () {
		return this._name
	}

	_size?: number
	_sizeOnFS?: number
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

	constructor ({ config, location, name }: TransparentDownloadArgs) {
		super()

		this.config = config
		this.config.queueSize = this.config.queueSize || {}
		this.config.queueSize.net = this.config.queueSize.net || 3

		this._location[1](location.slice(0, 32))
		this._encryptionKey[1](undefined)

		this._name = name

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

			const downloadUrl = downloadUrlRes.data

			this._downloadUrl = downloadUrl

			return downloadUrl
		})
	}

	async getMetadata (): Promise<FileMeta | undefined> {
		return this._m.runExclusive(async () => {
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
					async (b) => JSON.parse(await new Response(b).text()) as FileMeta,
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

	async downloadUrl (): Promise<string | undefined> {
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

		const downloadUrl = await d.downloadUrl().catch(d._reject)
		if (!downloadUrl) {
			return
		}

		const metadata = await d.getMetadata().catch(d._reject)
		if (!metadata) {
			return
		}

		d._size = metadata.size
		d._numberOfParts = numberOfParts(d._size)

		d.dispatchEvent(
			new DownloadStartedEvent({
				time: this._timestamps.start,
			}),
		)

		const netQueue = new OQ<void>(this.config.queueSize!.net)

		d._netQueue = netQueue

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

						d.dispatchEvent(new TransparentDownloadPartStartedEvent({ index: partIndex }))

						const res = await d.config.net
							.GET(
								downloadUrl + "/file",
								{
									range: `bytes=${partIndex * partSize}-${Math.min(d._size!, (partIndex + 1) * partSize) - 1}`,
								},
								undefined,
								async (rs) => (rs ? (polyfillReadableStreamIfNeeded(rs) as ReadableStream<Uint8Array>) : undefined),
							)
							.catch(d._reject)

						if (!res || !res.data) {
							return
						}

						let l = 0
						res.data.pipeTo(
							new WritableStream<Uint8Array>({
								async write (chunk) {
									l += chunk.length
									d.dispatchEvent(new DownloadProgressEvent({ progress: partIndex * partSize + l }))

									controller.enqueue(chunk)
								},
							}) as WritableStream<Uint8Array>,
						)

						d.dispatchEvent(new TransparentDownloadPartFinishedEvent({ index: partIndex }))
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

				// the start function is blocking for pulls so this must not be awaited
				netQueue.waitForClose().then(async () => {
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
