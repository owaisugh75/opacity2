import {
	ReadableStream as ReadableStreamPolyfill,
	WritableStream as WritableStreamPolyfill,
	TransformStream as TransformStreamPolyfill,
} from "web-streams-polyfill/ponyfill"

export const needsStreamPolyfill = () => {
	return !("ReadableStream" in globalThis && "WritableStream" in globalThis && "TransformStream" in globalThis)
}

export const ReadableStream = needsStreamPolyfill() ? ReadableStreamPolyfill : globalThis.ReadableStream
export const TransformStream = needsStreamPolyfill() ? TransformStreamPolyfill : globalThis.TransformStream
export const WritableStream = needsStreamPolyfill() ? WritableStreamPolyfill : globalThis.WritableStream

export const polyfillReadableStreamIfNeeded = <T>(rs: ReadableStream<T>, strategy?: QueuingStrategy<T>) => {
	if (!needsStreamPolyfill()) {
		return rs
	}

	const reader = rs.getReader()

	return new ReadableStreamPolyfill<T>(
		{
			async pull (controller) {
				const r = await reader.read()

				if (r.value) {
					controller.enqueue(r.value)
				}

				if (r.done) {
					controller.close()
				}
			},
		},
		strategy,
	)
}

export const polyfillWritableStreamIfNeeded = <T>(ws: WritableStream<T>, strategy?: QueuingStrategy<T>) => {
	if (!needsStreamPolyfill()) {
		return ws
	}

	const writer = ws.getWriter()

	return new WritableStreamPolyfill<T>(
		{
			async write (value: T) {
				return await writer.write(value)
			},
			async abort () {
				return await writer.abort()
			},
			async close () {
				return await writer.close()
			},
		},
		strategy,
	)
}

type Hooks = {
	transform?: (c: Uint8Array) => void
	enqueue?: (c: Uint8Array) => void
	flush?: (c: Uint8Array) => void
}

export class Uint8ArrayChunkStream implements TransformStream<Uint8Array, Uint8Array> {
	_size?: number
	_buffer?: Uint8Array
	_l = 0

	_hooks: Hooks

	_transformer: TransformStream<Uint8Array, Uint8Array>

	readable: ReadableStream<Uint8Array>
	writable: WritableStream<Uint8Array>

	constructor (
		size: number,
		writableStrategy?: QueuingStrategy<Uint8Array>,
		readableStrategy?: QueuingStrategy<Uint8Array>,
		hooks?: Hooks,
	) {
		this._hooks = hooks || {}

		this._size = size
		this._buffer = new Uint8Array(size)

		const t = this

		this._transformer = new TransformStream(
			{
				flush (controller) {
					const b = t._buffer!.slice(0, t._l)

					if (t._hooks.flush) {
						t._hooks.flush(b)
					}

					if (t._l != 0) {
						if (t._hooks.enqueue) {
							t._hooks.enqueue(b)
						}
						controller.enqueue(b)
					}

					delete t._buffer
					delete t._size
					t._l = 0
				},
				transform: t._transform.bind(t),
			},
			writableStrategy,
			readableStrategy,
		) as TransformStream

		this.readable = this._transformer.readable
		this.writable = this._transformer.writable
	}

	_transform (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
		if (this._hooks.transform) {
			this._hooks.transform(chunk)
		}

		let written = 0

		const numberOfChunks = Math.floor((this._l + chunk.length) / this._size!)

		for (let bufIndex = 0; bufIndex < numberOfChunks; bufIndex++) {
			const sl = this._l
			const l = this._size! - this._l

			for (let n = 0; n < this._size! - sl; n++) {
				this._buffer![this._l] = chunk[written + n]
				this._l++
			}

			written += l

			if (this._hooks.enqueue) {
				this?._hooks?.enqueue(this._buffer!)
			}
			controller.enqueue(this._buffer!)
			this._buffer = new Uint8Array(this._size!)
			this._l = 0
		}

		for (let i = written; i < chunk.length; i++) {
			this._buffer![this._l] = chunk[i]
			this._l++
		}
	}
}
