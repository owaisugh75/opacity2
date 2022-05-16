import { bytesToHex } from "@opacity/util/src/hex"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { FileMeta } from "./filemeta"
import { FileSystemObjectDeleteEvent } from "./events"
import { getPayload } from "@opacity/util/src/payload"
import { serializeEncrypted } from "@opacity/util/src/serializeEncrypted"
import { FileMetadata } from "@opacity/account-system/src"

export interface IFileSystemObject {
	readonly public: boolean
	readonly private: boolean

	readonly handle: Uint8Array | undefined
	readonly location: Uint8Array | undefined

	exists(): Promise<boolean>
	metadata(): Promise<FileMeta>
	size(): Promise<number>

	_beforeDelete?: (o: IFileSystemObject) => Promise<void>
	_afterDelete?: (o: IFileSystemObject) => Promise<void>
	delete(): Promise<void>
	deleteMultiFile(files: []): Promise<void>

	_beforeConvertToPublic?: (o: IFileSystemObject) => Promise<void>
	_afterConvertToPublic?: (o: IFileSystemObject, res: PrivateToPublicResp) => Promise<void>
	convertToPublic(): Promise<void>
}

export class FileSystemObjectDeletionError extends Error {
	constructor (location: string, err: string) {
		super(`DeletionError: Failed to delete "${location}". Error: "${err}"`)
	}
}

export class FileSystemObjectConvertPublicError extends Error {
	constructor (reason: string) {
		super(`ConvertPublicError: Failed to convert file because ${reason}`)
	}
}

export class FileSystemObjectMissingDataError extends Error {
	constructor (type: string) {
		super(`MissingDataError: Missing ${type} from object properties`)
	}
}

type PrivateToPublicObj = {
	fileHandle: string,
	fileSize: Number,
}

type PrivateToPublicResp = {
	s3_url: string
	s3_thumbnail_url: string
}

export type FileSystemObjectConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export type FileSystemObjectArgs = {
	handle: Uint8Array | undefined
	location: Uint8Array | undefined
	fileSize?: Number

	config: FileSystemObjectConfig
}

export class FileSystemObject extends EventTarget implements IFileSystemObject {
	_handle?: Uint8Array
	_location?: Uint8Array
	_fileSize?: Number

	get handle () {
		return this._handle
	}
	get location () {
		return this._location
	}
	get fileSize () {
		return this._fileSize
	}

	get public () {
		return !!this._location
	}
	get private () {
		return !!this._handle
	}

	config: FileSystemObjectConfig

	constructor ({ handle, location, fileSize, config }: FileSystemObjectArgs) {
		super()

		this._handle = handle
		this._location = location
		this._fileSize = fileSize

		this.config = config
	}

	private async _getDownloadURL (): Promise<string> {
		if (this._handle) {
			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v2/download/private",
				undefined,
				JSON.stringify({
					fileID: bytesToHex(this._handle.slice(0, 32)),
				}),
				(b) => new Response(b).text(),
			)

			if (res.status != 200 || !res.data) {
				throw new Error(`_getDownloadURL: failed to get download private url: ${res.data}`)
			}

			return res.data
		}

		if (this._location) {
			const res = await this.config.net.POST(
				this.config.storageNode + "/api/v2/download/public",
				undefined,
				JSON.stringify({
					fileID: bytesToHex(this._location.slice(0, 32)),
				}),
				(b) => new Response(b).text(),
			)

			if (res.status != 200 || !res.data) {
				throw new Error(`_getDownloadURL: failed to get public download url: ${res.data}`)
			}

			return res.data
		}

		throw new Error("_getDownloadURL: no valid sources found")
	}

	async exists () {
		if (!this._handle && !this._location) {
			console.warn(new Error("filesystem object already deleted"))

			return false
		}

		try {
			await this._getDownloadURL()

			return true
		} catch (err) {
			return false
		}
	}

	async metadata (): Promise<FileMeta> {
		if (!this._handle && !this._location) {
			throw new FileSystemObjectMissingDataError("handle and location")
		}

		const downloadURL = await this._getDownloadURL()

		const res = await this.config.net.GET(
			downloadURL + "/metadata",
			undefined,
			undefined,
			async (rs) => new Uint8Array(await new Response(rs).arrayBuffer()),
		)

		if (!res.ok) {
			throw new FileSystemObjectConvertPublicError(new TextDecoder().decode(res.data))
		}

		if (this._handle) {
			const serialized = await serializeEncrypted<FileMeta>(this.config.crypto, res.data, this._handle.slice(32, 64))
			return serialized
		}

		return JSON.parse(new TextDecoder().decode(res.data)) as FileMeta
	}

	_beforeDelete?: (o: IFileSystemObject) => Promise<void>
	_afterDelete?: (o: IFileSystemObject) => Promise<void>

	async delete () {
		if (!this._handle && !this._location) {
			console.warn("filesystem object already deleted")

			return
		}

		if (this._beforeDelete) {
			await this._beforeDelete(this)
		}

		const fileID = this._handle ? this._handle.slice(0, 32) : this._location.slice(0, 32);


		this.dispatchEvent(new FileSystemObjectDeleteEvent({}))

		const payload = await getPayload({
			crypto: this.config.crypto,
			payload: { fileID: bytesToHex(fileID) },
		})

		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v1/delete",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).text(),
		)

		if (res.status != 200) {
			throw new Error(`Error delete file from storage: ${res.data}`)
		}

		if (this._afterDelete) {
			await this._afterDelete(this)
		}

		// clear sensitive data

		this._handle && delete this._handle;
		this._location && delete this._location

		
	}

	async deleteMultiFile (files:   FileMetadata[]) {
		const fileIDs = files.map(item => bytesToHex(item.private.handle.slice(0, 32)))

		const payload = await getPayload({
			crypto: this.config.crypto,
			payload: { fileIDs },
		})

		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v2/delete",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).text(),
		)

		if (res.status != 200) {
			throw new Error(`Error delete multi-file storage: ${res.data}`)
		}
	}


	async size (): Promise<number> {
		const dl = await this._getDownloadURL()

		const res = await this.config.net.HEAD(dl + "/file")

		if (!res.ok) {
			throw new Error("failed to HEAD file")
		}

		const size = res.headers.get("content-length")

		if (!size) {
			throw new Error("failed to get file size")
		}

		return +size
	}

	_beforeConvertToPublic?: (o: IFileSystemObject) => Promise<void>
	_afterConvertToPublic?: (o: IFileSystemObject) => Promise<void>

	async convertToPublic (): Promise<void> {
		if (this._location) {
			throw new Error("file is already public")
		}

		if (!this._handle) {
			throw new Error("file has no private source")
		}

		if (this._beforeConvertToPublic) {
			await this._beforeConvertToPublic(this)
		}


		const payload = await getPayload<PrivateToPublicObj>({
			crypto: this.config.crypto,
			payload: {
				fileHandle: bytesToHex(this._handle),
				fileSize: this._fileSize
			},
		})

		const res = await this.config.net.POST<PrivateToPublicResp>(
			this.config.storageNode + "/api/v2/public-share/convert",
			undefined,
			JSON.stringify(payload),
			(b) => new Response(b).json(),
		)

		if(!res.ok) {
			throw new Error(`Error convert public share: ${res.data}`)
		}
		if (this._afterConvertToPublic) {
			await this._afterConvertToPublic(this)
		}

		this._location = this._handle.slice(0, 32)
		this._handle = undefined
	}
}
