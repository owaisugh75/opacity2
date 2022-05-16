import { Mutex } from "async-mutex"
import { posix } from "path-browserify"
import Automerge from "automerge/src/automerge"

import { arraysEqual } from "@opacity/util/src/arrayEquality"
import { bytesToB64URL } from "@opacity/util/src/b64"
import { bytesToHex } from "@opacity/util/src/hex"
import { cleanPath, isPathChild } from "@opacity/util/src/path"
import { entropyToKey } from "@opacity/util/src/mnemonic"
import { MetadataAccess } from "./MetadataAccess"
import { arrayMerge } from "@opacity/util/src/arrayMerge"

export type FilePrivateInfo = {
	// 64 bytes
	handle: Uint8Array | null
}

export type FilePublicInfo = {
	// 32 bytes
	location: Uint8Array | null
	shortLinks: string[]
}

export type FilePublicInfoMinimal = {
	location: Uint8Array | null
}

export type FilesIndexEntry = {
	location: Uint8Array
	finished: boolean
	private: FilePrivateInfo
	public: FilePublicInfo
	deleted: boolean
	errored: boolean
}

export type FilesIndex = { files: FilesIndexEntry[] }

export type FileCreationMetadata = {
	size: number
	lastModified: number
	type: string
}

export type FileMetadata = {
	location: Uint8Array
	name: string
	folderDerive: Uint8Array
	size: number
	uploaded: number
	modified: number
	type: string
	finished: boolean
	private: FilePrivateInfo
	public: FilePublicInfo
}

export type FoldersIndexEntry = {
	location: Uint8Array
	path: string
}

export type FoldersIndex = { folders: FoldersIndexEntry[] }

export type FolderFileEntry = {
	location: Uint8Array
	name: string
}

export type FolderMetadata = {
	location: Uint8Array
	name: string
	path: string
	size: number
	uploaded: number
	modified: number
	files: FolderFileEntry[]
}

export type ShareIndexEntry = {
	// 32 bytes
	locationKey: Uint8Array
	// 32 bytes
	encryptionKey: Uint8Array
	// 64 bytes []
	fileHandles: Uint8Array[]
	// 32 bytes []
	fileLocations: Uint8Array[]
}

export type ShareIndex = { shared: ShareIndexEntry[] }

export type ShareFileMetadataInit = {
	/**
	 * Metadata location.
	 * Used to pull in file metadata
	 */
	location: Uint8Array
	/**
	 * Path within the shared structure
	 */
	path: string
}

export type ShareFileMetadata = {
	name: string
	path: string
	size: number
	uploaded: number
	modified: number
	type: string
	private: FilePrivateInfo
	public: FilePublicInfo
}

export type ShareMetadata = {
	locationKey: Uint8Array
	encryptionKey: Uint8Array
	dateShared: number
	files: ShareFileMetadata[]
}

export type UploadThread = {
	uploaderId: string
	isUploading: boolean
	isCancelled: boolean
}

export class AccountSystemLengthError extends Error {
	constructor(item: string, min: number, max: number, recieved: number) {
		super(`AccountSystemLengthError: Invalid length of "${item}". Expected between ${min} and ${max}. Got ${recieved}`)
	}
}

export class AccountSystemAlreadyExistsError extends Error {
	constructor(type: string, path: string) {
		super(`AccountSystemAlreadyExistsError: ${type} "${path}" already exists`)
	}
}

export class AccountSystemSanitizationError extends Error {
	constructor(type: string, path: string, illegal: string[]) {
		super(
			`AccountSystemSanitizationError: ${type} "${path}" includes illegal characters "${illegal
				.map((s) => `"${s}"`)
				.join(", ")}"`,
		)
	}
}

export class AccountSystemNotFoundError extends Error {
	constructor(type: string, path: string) {
		super(`AccountSystemNotFoundError: ${type} "${path}" not found`)
	}
}

export class AccountSystemNotEmptyError extends Error {
	constructor(type: string, path: string, action: string) {
		super(`AccountSystemNotEmptyError: ${type} "${path}" must be empty to ${action}`)
	}
}

const validateFilename = (name: string) => {
	// https://serverfault.com/questions/9546/filename-length-limits-on-linux
	if (name.length < 1 || name.length > 255) {
		throw new AccountSystemLengthError(`filename ("${name}")`, 1, 255, name.length)
	}

	//https://stackoverflow.com/questions/457994/what-characters-should-be-restricted-from-a-unix-file-name
	if (name.includes(posix.sep) || name.includes("\0")) {
		throw new AccountSystemSanitizationError("file", name, [posix.sep, "\0"])
	}
}

const validateDirectoryPath = (path: string) => {
	if (path == "/") {
		return
	}

	for (let dir of path.split(posix.sep).slice(1)) {
		try {
			validateFilename(dir)
		} catch (err) {
			if (err instanceof AccountSystemLengthError) {
				throw new AccountSystemLengthError(`directory ("${dir}" of "${path}")`, 1, 255, dir.length)
			}
			else if (err instanceof AccountSystemSanitizationError) {
				throw new AccountSystemSanitizationError("directory", dir, [posix.sep, "\0"])
			}
			else {
				throw err
			}
		}
	}
}

const unfreezeUint8Array = (arr: Automerge.FreezeObject<Uint8Array>) => {
	return new Uint8Array(Object.values<number>(arr))
}

const unfreezeFileMetadata = (doc: Automerge.FreezeObject<FileMetadata>): FileMetadata => {
	return {
		location: unfreezeUint8Array(doc.location),
		name: doc.name,
		folderDerive: unfreezeUint8Array(doc.folderDerive),
		size: doc.size,
		uploaded: doc.uploaded,
		modified: doc.modified,
		type: doc.type,
		finished: !!doc.finished,
		private: {
			handle: doc?.private?.handle ? unfreezeUint8Array(doc.private.handle) : null,
		},
		public: {
			location: doc?.public?.location ? unfreezeUint8Array(doc.public.location) : null,
			shortLinks: doc.public.shortLinks.map((sl) => sl) || [],
		},
	}
}

const unfreezeFolderMetadata = (doc: Automerge.FreezeObject<FolderMetadata>): FolderMetadata => {
	return {
		location: unfreezeUint8Array(doc.location),
		name: doc.name,
		path: doc.path,
		size: doc.size,
		uploaded: doc.uploaded,
		modified: doc.modified,
		files: doc.files.map((file) => ({
			location: unfreezeUint8Array(file.location),
			name: file.name,
		})),
	}
}

const unfreezeShareMetadata = (doc: Automerge.FreezeObject<ShareMetadata>): ShareMetadata => {
	return {
		locationKey: unfreezeUint8Array(doc.locationKey),
		encryptionKey: unfreezeUint8Array(doc.encryptionKey),
		dateShared: doc.dateShared,
		files: doc.files.map((file) => ({
			name: file.name,
			path: file.path,
			size: file.size,
			uploaded: file.uploaded,
			modified: file.modified,
			type: file.type,
			private: {
				handle: file?.private?.handle ? unfreezeUint8Array(file.private.handle) : null,
			},
			public: {
				location: file?.public?.location ? unfreezeUint8Array(file.public.location) : null,
				shortLinks: file?.public?.shortLinks ? file.public.shortLinks.map((sl) => sl) : [],
			},
		})),
	}
}

export type AccountSystemConfig = {
	metadataAccess: MetadataAccess
}

export class AccountSystem {
	config: AccountSystemConfig

	guid = "5b7c0640-bc3a-4fa8-b588-ca6a922c1475"
	version = 2
	prefix = "/" + this.guid + "/v" + this.version

	indexes = {
		// preferences: this.prefix + "/preferences",
		files: this.prefix + "/files",
		folders: this.prefix + "/folders",
		// tags: this.prefix + "/tags",
		share: this.prefix + "/share",
	}

	_m = new Mutex()

	_uploadThreads:UploadThread[] = []

	constructor(config: AccountSystemConfig) {
		this.config = config
	}

	///////////////////////////////
	///////// Preferences /////////
	///////////////////////////////

	///////////////////////////////
	//////////// Files ////////////
	///////////////////////////////

	getFileDerivePath(location: Uint8Array): string {
		return this.prefix + "/file/" + bytesToB64URL(location)
	}

	async getFilesIndex(markCacheDirty = false): Promise<FilesIndex> {
		// console.log("getFilesIndex(", ")")

		return await this._m.runExclusive(() => this._getFilesIndex(markCacheDirty))
	}

	async _getFilesIndex(markCacheDirty = false): Promise<FilesIndex> {
		// console.log("_getFilesIndex(", ")")

		const filesIndex =
			(await this.config.metadataAccess.get<FilesIndex>(this.indexes.files, markCacheDirty)) ||
			Automerge.from<FilesIndex>({ files: [] })

		// TODO: find orphans

		return {
			files: filesIndex.files.map((file) => ({
				location: unfreezeUint8Array(file.location),
				finished: !!file.finished,
				private: {
					handle: file?.private?.handle ? unfreezeUint8Array(file.private.handle) : null,
				},
				public: {
					location: file?.public?.location ? unfreezeUint8Array(file.public.location) : null,
					shortLinks: file?.public?.shortLinks ? file.public.shortLinks.map((sl) => sl) : [],
				},
				deleted: !!file.deleted,
				errored: false,
			})),
		}
	}

	async getFileMetadataLocationByFileHandle(fileHandle: Uint8Array, markCacheDirty = false): Promise<Uint8Array> {
		// console.log("getFileMetadataLocationByFileHandle(", fileHandle, ")")

		return await this._m.runExclusive(() => this._getFileMetadataLocationByFileHandle(fileHandle, markCacheDirty))
	}

	async _getFileMetadataLocationByFileHandle(fileHandle: Uint8Array, markCacheDirty = false): Promise<Uint8Array> {
		// console.log("_getFileMetadataLocationByFileHandle(", fileHandle, ")")

		const filesIndex = await this._getFilesIndex(markCacheDirty)

		const fileEntry = filesIndex.files.find(
			(file) => file.private.handle && arraysEqual(file.private.handle, fileHandle),
		)

		if (!fileEntry) {
			throw new AccountSystemNotFoundError("file of handle", bytesToHex(fileHandle.slice(0, 32)) + "...")
		}

		return fileEntry.location
	}

	async getFileMetadataLocationByFileLocation(fileLocation: Uint8Array, markCacheDirty = false): Promise<Uint8Array> {
		// console.log("getFileMetadataLocationByFileLocation(", fileLocation, ")")

		return await this._m.runExclusive(() => this._getFileMetadataLocationByFileLocation(fileLocation, markCacheDirty))
	}

	async _getFileMetadataLocationByFileLocation(fileLocation: Uint8Array, markCacheDirty = false): Promise<Uint8Array> {
		// console.log("_getFileMetadataLocationByFileLocation(", fileLocation, ")")

		const filesIndex = await this._getFilesIndex(markCacheDirty)

		const fileEntry = filesIndex.files.find(
			(file) => file.public.location && arraysEqual(file.public.location, fileLocation),
		)

		if (!fileEntry) {
			throw new Error("Error get metadata location with file location")
		}

		return fileEntry.location
	}

	async getFileIndexEntryByFileMetadataLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FilesIndexEntry> {
		// console.log("getFileIndexEntryByFileMetadataLocation(", location, ")")

		return await this._m.runExclusive(() => this._getFileIndexEntryByFileMetadataLocation(location, markCacheDirty))
	}

	async _getFileIndexEntryByFileMetadataLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FilesIndexEntry> {
		// console.log("_getFileIndexEntryByFileMetadataLocation(", location, ")")

		const filesIndex = await this._getFilesIndex(markCacheDirty)
		const fileEntry = filesIndex.files.find((file) => arraysEqual(file.location, location))

		if (!fileEntry) {
			// TODO: orphan?
			throw new AccountSystemNotFoundError("file", bytesToB64URL(location))
		}

		return {
			location: fileEntry.location,
			finished: !!fileEntry.finished,
			private: {
				handle: fileEntry.private.handle,
			},
			public: {
				location: fileEntry.public.location,
				shortLinks: fileEntry.public.shortLinks,
			},
			deleted: !!fileEntry.deleted,
			errored: !!fileEntry.errored,
		}
	}

	async getFileMetadata(location: Uint8Array, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("getFileMetadata(", location, ")")

		return await this._m.runExclusive(() => this._getFileMetadata(location, markCacheDirty))
	}

	async _getFileMetadata(location: Uint8Array, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("_getFileMetadata(", location, ")")

		const filePath = this.getFileDerivePath(location)

		const doc = await this.config.metadataAccess.get<FileMetadata>(filePath, markCacheDirty)

		if (!doc) {
			throw new Error("Error get file metadata")
		}

		return unfreezeFileMetadata(doc)
	}

	async addUpload(
		// 32 bytes
		fileLocation: Uint8Array,
		// 32 bytes
		fileEncryptionKey: Uint8Array | undefined,
		path: string,
		filename: string,
		meta: FileCreationMetadata,
		pub: boolean,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("addUpload(", fileLocation, fileEncryptionKey, path, filename, meta, pub, ")")

		return await this._m.runExclusive(() =>
			this._addUpload(fileLocation, fileEncryptionKey, path, filename, meta, pub, markCacheDirty),
		)
	}

	async _addUpload(
		fileLocation: Uint8Array,
		fileEncryptionKey: Uint8Array | undefined,
		path: string,
		filename: string,
		meta: FileCreationMetadata,
		pub: boolean,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("_addUpload(", fileLocation, fileEncryptionKey, path, filename, meta, pub, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)
		validateFilename(filename)

		const folder = await this._addFolder(path, markCacheDirty).catch(() => {
			throw new Error("Error add folder metadata");
		})
		const folderDerive = folder.location

		const metaLocation = await this.config.metadataAccess.config.crypto.getRandomValues(32)
		const filePath = this.getFileDerivePath(metaLocation)

		const fileHandle = fileEncryptionKey ? arrayMerge(fileLocation, fileEncryptionKey) : fileLocation

		const file = await this.config.metadataAccess.change<FileMetadata>(
			filePath,
			`Init file metadata for "${bytesToB64URL(metaLocation)}"`,
			(doc) => {
				doc.location = metaLocation
				doc.name = filename
				doc.folderDerive = folderDerive
				doc.modified = meta.lastModified
				doc.size = meta.size
				doc.type = meta.type
				doc.uploaded = Date.now()
				doc.finished = true
				doc.private = {
					handle: fileHandle,
				}
				doc.public = {
					location: pub ? fileLocation : null,
					shortLinks: [],
				}
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Error Init file metadata");
		})

		return unfreezeFileMetadata(file)
	}


	async cancelUpload(uploaderId: string): Promise<boolean> {
		const uploaderIndex = this._uploadThreads.findIndex(item => item.uploaderId === uploaderId)

		if(uploaderIndex > -1) {
			if(this._uploadThreads[uploaderIndex].isUploading === false) {
				this._uploadThreads[uploaderIndex].isCancelled = true
			} else {
				return false
			}
		} else {
			this._uploadThreads.push({
				uploaderId,
				isUploading: false,
				isCancelled: true,
			})
		}
		return true
	}

	async finishUpload(fileMeta: FileMetadata, uploaderId: string, markCacheDirty = false): Promise<void> {

		const release = await this._m.acquire()
		
		const uploaderIndex = this._uploadThreads.findIndex(item => item.uploaderId === uploaderId)
		if(uploaderIndex > -1) {
			this._uploadThreads[uploaderIndex].isUploading = true
		} else {
			this._uploadThreads.push({
				uploaderId,
				isUploading: true,
				isCancelled: false,
			})
		}
		const res = await this._finishUpload(fileMeta, uploaderId, markCacheDirty)

		release()

		return res
	}

	async _finishUpload(fileMeta: FileMetadata, uploaderId: string, markCacheDirty = false): Promise<any> {
		// console.log("_finishUpload(", location, ")")
		const uploaderIndex = this._uploadThreads.findIndex(item => item.uploaderId === uploaderId)

		if(uploaderIndex > -1 && this._uploadThreads[uploaderIndex].isCancelled === false) {
			const res = await this.config.metadataAccess.multiChange<any>(
				this.indexes.files,
				this.getFolderDerivePath(unfreezeUint8Array(fileMeta.folderDerive)),
				`Add file "${fileMeta.location}" to file index && to folder`,
				(doc:any) => {
					if (!doc.files) {
						doc.files = []
					}
					doc.files.push({
						location: fileMeta.location,
						finished: true,
						private: {
							handle: fileMeta.private.handle,
						},
						public: {
							location: null,
							shortLinks: []
						},
						deleted: false,
						errored: false,
					})
				},
				(doc:any) => {
					if (!doc.files) {
						doc.files = []
					}
					doc.files.push({
						name: fileMeta.name,
						location: fileMeta.location,
					})
	
					doc.modified = Date.now()
					doc.size++
				},
				markCacheDirty,
			)
			
			this._uploadThreads.slice(uploaderIndex, 1)

			return res
		} else {
			return null
		}
	}

	async setFilePrivateHandle(
		location: Uint8Array,
		newFileHandle: Uint8Array | null,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("setFileHandle(", location, newFileHandle, ")")

		return await this._m.runExclusive(() => this._setFilePrivateHandle(location, newFileHandle, markCacheDirty))
	}

	async _setFilePrivateHandle(
		location: Uint8Array,
		newFileHandle: Uint8Array | null,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("_setFileHandle(", location, newFileHandle, ")")

		const filesIndex = await this._getFilesIndex(markCacheDirty)
		const fileEntry = filesIndex.files.find((fileEntry) => arraysEqual(fileEntry.location, location))

		if (!fileEntry) {
			throw new AccountSystemNotFoundError("file entry", bytesToB64URL(location))
		}

		await this.config.metadataAccess.change<FilesIndex>(
			this.indexes.files,
			`Change handle for file "${bytesToB64URL(location)}"`,
			(doc) => {
				const entryIndex = doc.files.findIndex((fileEntry) => arraysEqual(fileEntry.location, location))

				doc.files[entryIndex].private.handle = newFileHandle
			},
			markCacheDirty,
		)

		const fileMetaDoc = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(location),
			"Change handle",
			(doc) => {
				doc.private.handle = newFileHandle
			},
			markCacheDirty,
		)

		return unfreezeFileMetadata(fileMetaDoc)
	}

	async setFilePublicLocation(
		location: Uint8Array,
		newFileLocation: Uint8Array | null,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("setFilePublicLocation(", location, newFileLocation, ")")

		return await this._m.runExclusive(() => this._setFilePublicLocation(location, newFileLocation, markCacheDirty))
	}

	async _setFilePublicLocation(
		location: Uint8Array,
		newFileLocation: Uint8Array | null,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("_setFilePublicLocation(", location, newFileLocation, ")")

		const filesIndex = await this._getFilesIndex(markCacheDirty)
		const fileEntry = filesIndex.files.find((fileEntry) => arraysEqual(fileEntry.location, location))

		if (!fileEntry) {
			throw new Error("File entry does not exist")
		}

		await this.config.metadataAccess.change<FilesIndex>(
			this.indexes.files,
			`Change file location for file "${bytesToB64URL(location)}"`,
			(doc) => {
				const entryIndex = doc.files.findIndex((fileEntry) => arraysEqual(fileEntry.location, location))

				doc.files[entryIndex].public.location = newFileLocation
			},
			markCacheDirty,
		)

		const fileMetaDoc = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(location),
			"Change file location",
			(doc) => {
				doc.public.location = newFileLocation
			},
			markCacheDirty,
		)

		return unfreezeFileMetadata(fileMetaDoc)
	}

	async addFilePublicShortlink(
		location: Uint8Array,
		shortlink: string,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("addFilePublicShortlink(", location, shortlink, ")")

		return await this._m.runExclusive(() => this._addFilePublicShortlink(location, shortlink, markCacheDirty))
	}

	async _addFilePublicShortlink(
		location: Uint8Array,
		shortlink: string,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("_addFilePublicShortlink(", location, shortlink, ")")

		const fileMetaDoc = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(location),
			"Add shortlink",
			(doc) => {
				doc.public.shortLinks.push(shortlink)
			},
			markCacheDirty,
		)

		return unfreezeFileMetadata(fileMetaDoc)
	}

	async removeFilePublicShortlink(
		location: Uint8Array,
		shortlink: string,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("removeFilePublicShortlink(", location, shortlink, ")")

		return await this._m.runExclusive(() => this._removeFilePublicShortlink(location, shortlink, markCacheDirty))
	}

	async _removeFilePublicShortlink(
		location: Uint8Array,
		shortlink: string,
		markCacheDirty = false,
	): Promise<FileMetadata> {
		// console.log("_removeFilePublicShortlink(", location, shortlink, ")")

		const fileMetaDoc = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(location),
			"Remove shortlink",
			(doc) => {
				// const shortlinkIndex = doc.public.shortLinks.indexOf(shortlink)
				// shortlinkIndex > 0 && doc.public.shortLinks.splice(shortlinkIndex, 1)
				doc.public.shortLinks = []
				doc.public.location = null
			},
			markCacheDirty,
		)

		// console.log('revoke unfreeze', unfreezeFileMetadata(fileMetaDoc))
		return unfreezeFileMetadata(fileMetaDoc)
	}

	async renameFile(location: Uint8Array, newName: string, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("renameFile(", location, newName, ")")

		return await this._m.runExclusive(() => this._renameFile(location, newName, markCacheDirty))
	}

	async _renameFile(location: Uint8Array, newName: string, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("_renameFile(", location, newName, ")")

		validateFilename(newName)

		const fileIndexEntry = await this._getFileIndexEntryByFileMetadataLocation(location, markCacheDirty)
		if (!fileIndexEntry) {
			throw new AccountSystemNotFoundError("file", bytesToB64URL(location))
		}

		const fileMeta = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(fileIndexEntry.location),
			"Rename file",
			(doc) => {
				doc.name = newName
			},
			markCacheDirty,
		)

		await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(unfreezeUint8Array(fileMeta.folderDerive)),
			`Rename file ${bytesToB64URL(location)}`,
			(doc) => {
				const fileEntry = doc.files.find((file) => arraysEqual(location, file.location))

				if (!fileEntry) {
					throw new AccountSystemNotFoundError(
						"file entry",
						`"${bytesToB64URL(location)}" in "${bytesToB64URL(unfreezeUint8Array(fileMeta.folderDerive))}"`,
					)
				}

				fileEntry.name = newName
			},
			markCacheDirty,
		)

		return unfreezeFileMetadata(fileMeta)
	}

	async moveFile(location: Uint8Array, newPath: string, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("moveFile(", location, newPath, ")")

		return await this._m.runExclusive(() => this._moveFile(location, newPath, markCacheDirty))
	}

	async _moveFile(location: Uint8Array, newPath: string, markCacheDirty = false): Promise<FileMetadata> {
		// console.log("_moveFile(", location, newPath, ")")

		newPath = cleanPath(newPath)
		validateDirectoryPath(newPath)

		const folder = await this._addFolder(newPath, markCacheDirty)
		const folderDerive = folder.location

		const oldFileMeta = await this._getFileMetadata(location, markCacheDirty)

		const newFolder = await this._addFolder(newPath, markCacheDirty)

		await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(newFolder.location),
			`Move file ${bytesToB64URL(location)}`,
			(doc) => {
				doc.files.push({
					location,
					name: oldFileMeta.name,
				})

				doc.modified = Date.now()
				doc.size++
			},
			markCacheDirty,
		)

		await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(oldFileMeta.folderDerive),
			`Move file ${bytesToB64URL(location)}`,
			(doc) => {
				const fileEntryIndex = doc.files.findIndex((file) => arraysEqual(location, file.location))

				if (fileEntryIndex == -1) {
					throw new AccountSystemNotFoundError(
						"file entry",
						`"${bytesToB64URL(location)}" in "${bytesToB64URL(oldFileMeta.folderDerive)}"`,
					)
				}

				doc.files.splice(fileEntryIndex, 1)

				doc.modified = Date.now()
				doc.size--
			},
			markCacheDirty,
		)

		const newFileMeta = await this.config.metadataAccess.change<FileMetadata>(
			this.getFileDerivePath(location),
			"Move file",
			(doc) => {
				doc.folderDerive = folderDerive
			},
			markCacheDirty,
		)

		return unfreezeFileMetadata(newFileMeta)
	}

	async removeFile(location: Uint8Array, markCacheDirty = false) {
		// console.log("removeFile(", location, ")")

		return await this._m.runExclusive(() => this._removeFile(location, markCacheDirty))
	}

	async _removeFile(location: Uint8Array, markCacheDirty = false) {
		// console.log("_removeFile(", location, ")")

		const fileMeta = await this._getFileMetadata(location, markCacheDirty).catch(() => {
			throw new Error("Error get metadata index");
		})

		await this.config.metadataAccess.multiChange<any>(
			this.indexes.files,
			this.getFolderDerivePath(fileMeta.folderDerive),
			`Mark upload deleted & Remove file`,
			(doc:any) => {
				const fileEntry = doc.files.find((file:any) => arraysEqual(unfreezeUint8Array(file.location), location))

				if (!fileEntry) {
					throw new Error("file entry not found")
				}

				fileEntry.deleted = true
			},
			(doc:any) => {
				const fileIndex = doc.files.findIndex((file:any) => arraysEqual(unfreezeUint8Array(file.location), location))

				fileIndex !== -1 && doc.files.splice(fileIndex, 1)
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Error Mark upload deleted & Remove file")
		})

		await this.config.metadataAccess.delete(this.getFileDerivePath(location)).catch(() => {
			throw new Error("Error delete metadata");
		})
	}

	async removeMultiFile(locations: Uint8Array[], markCacheDirty = false) {

		return await this._m.runExclusive(() => this._removeMultiFile(locations, markCacheDirty))
	}

	async _removeMultiFile(locations: Uint8Array[], markCacheDirty = false) {

		const fileMeta = await this._getFileMetadata(locations[0], markCacheDirty).catch(() => {
			throw new Error("Error get metadata index");
		})

		await this.config.metadataAccess.multiChange<any>(
			this.indexes.files,
			this.getFolderDerivePath(fileMeta.folderDerive),
			`Mark upload multi deleted & Remove multi file`,
			(doc:any) => {
				locations.forEach(location => {
					const fileEntry = doc.files.find((file:any) => arraysEqual(unfreezeUint8Array(file.location), location))

					if (!fileEntry) {
						throw new AccountSystemNotFoundError("file entry", bytesToB64URL(location))
					}

					fileEntry.deleted = true
				})
			},
			(doc:any) => {
				locations.forEach(location => {
					const fileIndex = doc.files.findIndex((file:any) => arraysEqual(unfreezeUint8Array(file.location), location))

					fileIndex !== -1 && doc.files.splice(fileIndex, 1)
				})
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Mark upload multi deleted & Remove multi file")
		})

		await this.config.metadataAccess.multiDelete(locations.map(location => this.getFileDerivePath(location))).catch(() => {
			throw new Error("Error multi-delete metadata");
		})
	}

	async _removeBrokenFile(currentPath: string, location: Uint8Array, markCacheDirty = false) {

		const folderMeta = await this.getFolderIndexEntryByPath(currentPath, markCacheDirty).catch(() => {
			throw new Error("Error get folder metadata index");
		})

		await this.config.metadataAccess.change<any>(
			this.getFolderDerivePath(folderMeta.location),
			"Remove corrupted file from folder",
			
			(doc:any) => {
				const fileIndex = doc.files.findIndex((file:any) => arraysEqual(unfreezeUint8Array(file.location), location))

				fileIndex !== -1 && doc.files.splice(fileIndex, 1)
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Error deleted corrupted file")
		})
	}

	///////////////////////////////
	/////////// Folders ///////////
	///////////////////////////////

	getFolderDerivePath(location: Uint8Array): string {
		return this.prefix + "/folder/" + bytesToB64URL(location)
	}

	async getFoldersIndex(markCacheDirty = false): Promise<FoldersIndex> {
		// console.log("getFoldersIndex(", ")")

		return await this._m.runExclusive(() => this._getFoldersIndex(markCacheDirty))
	}

	async _getFoldersIndex(markCacheDirty = false): Promise<FoldersIndex> {
		// console.log("_getFoldersIndex(", ")")

		const foldersIndex =
			(await this.config.metadataAccess.get<FoldersIndex>(this.indexes.folders, markCacheDirty)) ||
			Automerge.from<FoldersIndex>({ folders: [] })

		// TODO: find orphans

		const duplicates = new Set(
			(foldersIndex.folders || []).map(({ path }) => path).filter((p, i, arr) => arr.indexOf(p) != i),
		)

		// TODO: merge duplicate folders
		for (let dup of duplicates) {
		}

		// TODO: find underlying cause of folders being undefined
		return {
			folders: (foldersIndex.folders || []).map((folder) => ({
				location: unfreezeUint8Array(folder.location),
				path: folder.path,
			})),
		}
	}

	async getFolderIndexEntryByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry> {
		// console.log("getFolderIndexEntryByPath(", path, ")")

		return await this._m.runExclusive(() => this._getFolderIndexEntryByPath(path, markCacheDirty))
	}

	async _getFolderIndexEntryByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry> {
		// console.log("_getFolderIndexEntryByPath(", path, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)
		const folderEntry = foldersIndex.folders.find((folder) => folder.path == path)

		if (!folderEntry) {
			// TODO: orphan?
			throw new Error("Error get folder index entry by path")
		}

		return {
			location: folderEntry.location,
			path: folderEntry.path,
		}
	}

	async getFoldersInFolderByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("getFoldersInFolderByPath(", path, ")")

		return await this._m.runExclusive(() => this._getFoldersInFolderByPath(path, markCacheDirty))
	}

	async _getFoldersInFolderByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("_getFoldersInFolderByPath(", path, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		return foldersIndex.folders.filter((folder) => isPathChild(path, folder.path))
	}

	async getAllFoldersInFolderRecursivelyByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("getAllFoldersInFolderRecursivelyByPath(", path, ")")

		return await this._m.runExclusive(() => this._getAllFoldersInFolderRecursivelyByPath(path, markCacheDirty))
	}

	async _getAllFoldersInFolderRecursivelyByPath(path: string, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("_getAllFoldersInFolderRecursivelyByPath(", path, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		return (
			await Promise.all(
				foldersIndex.folders
					.filter((folder) => isPathChild(path, folder.path))
					.map(async (folder) => [folder, await this._getAllFoldersInFolderRecursivelyByPath(folder.path)].flat()),
			)
		).flat()
	}

	async getAllFilesInFolderRecursivelyByPath(path: string, markCacheDirty = false): Promise<FilesIndexEntry[]> {
		// console.log("getAllFoldersInFolderRecursivelyByPath(", path, ")")

		return await this._m.runExclusive(() => this._getAllFilesInFolderRecursivelyByPath(path, markCacheDirty))
	}

	async _getAllFilesInFolderRecursivelyByPath(path: string, markCacheDirty = false): Promise<FilesIndexEntry[]> {
		// console.log("_getAllFoldersInFolderRecursivelyByPath(", path, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)

		const folderMeta = await this._getFolderMetadataByPath(path)
		const foldersInFolder = await this._getAllFoldersInFolderRecursivelyByPath(path, markCacheDirty)
		const filesIndex = await this._getFilesIndex()

		const filesInFolder = (
			await Promise.all(
				foldersInFolder.map(async (folder) => (await this._getFolderMetadataByPath(folder.path, markCacheDirty)).files),
			)
		).flat()

		return filesIndex.files.filter((fileEntry) =>
			([] as FolderFileEntry[])
				.concat(folderMeta.files, filesInFolder)
				.some((folderFileEntry) => arraysEqual(folderFileEntry.location, fileEntry.location)),
		)
	}

	async getFoldersInFolderByLocation(location: Uint8Array, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("getFoldersInFolderByLocation(", location, ")")

		return await this._m.runExclusive(() => this._getFoldersInFolderByLocation(location, markCacheDirty))
	}

	async _getFoldersInFolderByLocation(location: Uint8Array, markCacheDirty = false): Promise<FoldersIndexEntry[]> {
		// console.log("_getFoldersInFolderByLocation(", location, ")")

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		const folderEntry = foldersIndex.folders.find((folder) => arraysEqual(folder.location, location))

		if (!folderEntry) {
			throw new AccountSystemNotFoundError("folder entry", bytesToB64URL(location))
		}

		const path = folderEntry.path

		return foldersIndex.folders.filter((folder) => isPathChild(path, folder.path))
	}

	async getAllFoldersInFolderRecursivelyByLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FoldersIndexEntry[]> {
		// console.log("getAllFoldersInFolderRecursivelyByLocation(", location, ")")

		return await this._m.runExclusive(() => this._getAllFoldersInFolderRecursivelyByLocation(location, markCacheDirty))
	}

	async _getAllFoldersInFolderRecursivelyByLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FoldersIndexEntry[]> {
		// console.log("_getAllFoldersInFolderRecursivelyByLocation(", location, ")")

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		const folderEntry = foldersIndex.folders.find((folder) => arraysEqual(folder.location, location))

		if (!folderEntry) {
			throw new AccountSystemNotFoundError("folder entry", bytesToB64URL(location))
		}

		const path = folderEntry.path

		return (
			await Promise.all(
				foldersIndex.folders
					.filter((folder) => isPathChild(path, folder.path))
					.map(async (folder) =>
						[folder, await this._getAllFoldersInFolderRecursivelyByLocation(folder.location)].flat(),
					),
			)
		).flat()
	}

	async getAllFilesInFolderRecursivelyByLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FilesIndexEntry[]> {
		// console.log("getAllFoldersInFolderRecursivelyByLocation(", location, ")")

		return await this._m.runExclusive(() => this._getAllFilesInFolderRecursivelyByLocation(location, markCacheDirty))
	}

	async _getAllFilesInFolderRecursivelyByLocation(
		location: Uint8Array,
		markCacheDirty = false,
	): Promise<FilesIndexEntry[]> {
		// console.log("_getAllFoldersInFolderRecursivelyByLocation(", location, ")")

		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		const folderEntry = foldersIndex.folders.find((folder) => arraysEqual(folder.location, location))

		if (!folderEntry) {
			throw new AccountSystemNotFoundError("folder entry", bytesToB64URL(location))
		}

		const folderMeta = await this._getFolderMetadataByLocation(location)
		const foldersInFolder = await this._getAllFoldersInFolderRecursivelyByLocation(folderEntry.location, markCacheDirty)
		const filesIndex = await this._getFilesIndex()

		const filesInFolder = (
			await Promise.all(
				foldersInFolder.map(
					async (folder) => (await this._getFolderMetadataByLocation(folder.location, markCacheDirty)).files,
				),
			)
		).flat()

		return filesIndex.files.filter((fileEntry) =>
			([] as FolderFileEntry[])
				.concat(folderMeta.files, filesInFolder)
				.some((folderFileEntry) => arraysEqual(folderFileEntry.location, fileEntry.location)),
		)
	}

	async getFolderMetadataByPath(path: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("getFolderMetadataByPath(", path, ")")

		return await this._m.runExclusive(() => this._getFolderMetadataByPath(path, markCacheDirty))
	}

	async _getFolderMetadataByPath(path: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("_getFolderMetadataByPath(", path, ")")

		path = cleanPath(path)

		const folderEntry = await this._getFolderIndexEntryByPath(path, markCacheDirty)

		return await this._getFolderMetadataByLocation(folderEntry.location, markCacheDirty)
	}

	async getFolderMetadataByLocation(location: Uint8Array, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("getFolderMetadataByLocation(", location, ")")

		return await this._m.runExclusive(() => this._getFolderMetadataByLocation(location, markCacheDirty))
	}

	async _getFolderMetadataByLocation(location: Uint8Array, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("_getFolderMetadataByLocation(", location, ")")

		const folderPath = this.getFolderDerivePath(location)

		const doc = await this.config.metadataAccess.get<FolderMetadata>(folderPath, markCacheDirty)

		if (!doc) {
			throw new AccountSystemNotFoundError("folder", folderPath)
		}

		return unfreezeFolderMetadata(doc)
	}

	async addFolder(path: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("addFolder(", path, ")")

		// adding folders can result in duplication
		// marking the cache dirty reduces this risk
		await this.config.metadataAccess.markCacheDirty(this.indexes.folders)

		return await this._m.runExclusive(() => this._addFolder(path, markCacheDirty))
	}

	async _addFolder(path: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("_addFolder(", path, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)

		if (path != "/") {
			await this._addFolder(posix.dirname(path), markCacheDirty)
		}

		let foldersIndexDoc = await this._getFoldersIndex(markCacheDirty)

		const dup = foldersIndexDoc.folders.find((entry) => entry.path == path)

		if (dup) {
			return this._getFolderMetadataByLocation(dup.location)
		}

		const location = await this.config.metadataAccess.config.crypto.getRandomValues(32)

		const doc = await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(location),
			"Init folder metadata",
			(doc) => {
				doc.location = location
				doc.name = posix.basename(path)
				doc.path = path
				doc.modified = Date.now()
				doc.size = 0
				doc.uploaded = Date.now()
				doc.files = []
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Error Init folder metadata");
		})

		await this.config.metadataAccess.change<FoldersIndex>(
			this.indexes.folders,
			"Add folder to index",
			(doc) => {
				if (!doc.folders) {
					doc.folders = []
				}
				doc.folders.push({
					location: location,
					path,
				})
			},
			markCacheDirty,
		).catch(() => {
			throw new Error("Error Add folder to index");
		})
		
		return unfreezeFolderMetadata(doc)
	}

	async renameFolder(path: string, newName: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("renameFolder(", path, newName, ")")

		return await this._m.runExclusive(() => this._renameFolder(path, newName, markCacheDirty))
	}

	async _renameFolder(path: string, newName: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("_renameFolder(", path, newName, ")")

		path = cleanPath(path)
		validateDirectoryPath(path)
		validateFilename(newName)

		return await this._moveFolder(path, posix.join(posix.dirname(path), newName), markCacheDirty)
	}

	async moveFolder(oldPath: string, newPath: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("moveFolder(", oldPath, newPath, ")")

		return await this._m.runExclusive(() => this._moveFolder(oldPath, newPath, markCacheDirty))
	}

	async _moveFolder(oldPath: string, newPath: string, markCacheDirty = false): Promise<FolderMetadata> {
		// console.log("_moveFolder(", oldPath, newPath, ")")

		oldPath = cleanPath(oldPath)
		newPath = cleanPath(newPath)
		validateDirectoryPath(oldPath)
		validateDirectoryPath(newPath)

		const op = posix.dirname(oldPath) == posix.dirname(newPath) ? "Rename" : "Move"

		const newFolder = await this._getFolderIndexEntryByPath(newPath, markCacheDirty).catch(() => { })
		if (newFolder) {
			throw new AccountSystemAlreadyExistsError("folder", newPath)
		}

		const folderEntry = await this._getFolderIndexEntryByPath(oldPath, markCacheDirty)
		if (!folderEntry) {
			throw new AccountSystemNotFoundError("folder", oldPath)
		}

		// moving folders can result in duplication
		// marking the cache dirty reduces this risk
		await this.config.metadataAccess.markCacheDirty(this.indexes.folders)
		const foldersIndex = await this._getFoldersIndex(markCacheDirty)

		await this.config.metadataAccess.change<FoldersIndex>(
			this.indexes.folders,
			`${op} folder`,
			(doc) => {
				const subs = doc.folders.filter((folderEntry) => posix.relative(oldPath, folderEntry.path).indexOf("../") != 0)

				for (let folderEntry of subs) {
					folderEntry.path = posix.join(newPath, posix.relative(oldPath, folderEntry.path))
				}
			},
			markCacheDirty,
		)

		const subs = foldersIndex.folders.filter((folderEntry) => {
			const rel = posix.relative(oldPath, folderEntry.path)

			return rel != "" && rel.indexOf("../") != 0
		})

		for (let folderEntry of subs) {
			await this.config.metadataAccess.change<FolderMetadata>(
				this.getFolderDerivePath(folderEntry.location),
				`${op} folder`,
				(doc) => {
					doc.path = posix.join(newPath, posix.relative(oldPath, folderEntry.path))
				},
				markCacheDirty,
			)
		}

		const doc = await this.config.metadataAccess.change<FolderMetadata>(
			this.getFolderDerivePath(folderEntry.location),
			`${op} folder`,
			(doc) => {
				doc.name = posix.basename(newPath)
				doc.path = newPath
			},
			markCacheDirty,
		)

		return unfreezeFolderMetadata(doc)
	}

	async removeFolderByPath(path: string, markCacheDirty = false): Promise<void> {
		// console.log("removeFolderByPath(", path, ")")

		return await this._m.runExclusive(() => this._removeFolderByPath(path, markCacheDirty))
	}

	async _removeFolderByPath(path: string, markCacheDirty = false): Promise<void> {
		// console.log("_removeFolderByPath(", path, ")")

		path = cleanPath(path)

		const folderEntry = await this._getFolderIndexEntryByPath(path, markCacheDirty)

		return await this._removeFolderByLocation(folderEntry.location, markCacheDirty)
	}

	async removeFolderByLocation(location: Uint8Array, markCacheDirty = false): Promise<void> {
		// console.log("removeFolderByLocation(", location, ")")

		return await this._m.runExclusive(() => this._removeFolderByLocation(location, markCacheDirty))
	}

	async _removeFolderByLocation(location: Uint8Array, markCacheDirty = false): Promise<void> {
		// console.log("_removeFolderByLocation(", location, ")")

		const folderMeta = await this._getFolderMetadataByLocation(location, markCacheDirty)

		if (folderMeta.files.length) {
			throw new AccountSystemNotEmptyError("folder", bytesToB64URL(location), "remove")
		}

		const childFolders = await this._getFoldersInFolderByLocation(location, markCacheDirty)
		await Promise.all(childFolders.map((folder) => this._removeFolderByLocation(folder.location)))

		await this.config.metadataAccess.delete(this.getFolderDerivePath(location))

		await this.config.metadataAccess.change<FoldersIndex>(
			this.indexes.folders,
			`Remove folder ${bytesToB64URL(location)}`,
			(doc) => {
				const folderIndex = doc.folders.findIndex((file) => arraysEqual(unfreezeUint8Array(file.location), location))

				folderIndex !== -1 && doc.folders.splice(folderIndex, 1)
			},
			markCacheDirty,
		)
	}

	async _removeBrokenFolder(location: Uint8Array, markCacheDirty = false) {
		await this.config.metadataAccess.change<FoldersIndex>(
			this.indexes.folders,
			`Remove broken folder ${bytesToB64URL(location)}`,
			(doc) => {
				const folderIndex = doc.folders.findIndex((file) => arraysEqual(unfreezeUint8Array(file.location), location))

				folderIndex !== -1 && doc.folders.splice(folderIndex, 1)
			},
			markCacheDirty,
		)
	}

	///////////////////////////////
	//////////// Tags  ////////////
	///////////////////////////////

	///////////////////////////////
	//////////// Share ////////////
	///////////////////////////////

	getShareHandle(meta: ShareMetadata | ShareIndexEntry): Uint8Array {
		return new Uint8Array(Array.from(meta.locationKey).concat(Array.from(meta.encryptionKey)))
	}

	async getShareIndex(markCacheDirty = false): Promise<ShareIndex> {
		// console.log("getShareIndex(", ")")

		return await this._m.runExclusive(() => this._getShareIndex(markCacheDirty))
	}

	async _getShareIndex(markCacheDirty = false): Promise<ShareIndex> {
		// console.log("_getShareIndex(", ")")

		const sharedIndex =
			(await this.config.metadataAccess.get<ShareIndex>(this.indexes.share, markCacheDirty)) ||
			Automerge.from<ShareIndex>({ shared: [] })

		// TODO: find orphans

		return {
			shared: sharedIndex.shared.map((shareEntry) => ({
				locationKey: unfreezeUint8Array(shareEntry.locationKey),
				encryptionKey: unfreezeUint8Array(shareEntry.encryptionKey),
				fileHandles: shareEntry.fileHandles.map((h) => unfreezeUint8Array(h)),
				fileLocations: shareEntry.fileLocations.map((l) => unfreezeUint8Array(l)),
			})),
		}
	}

	async getSharesByHandle(handle: Uint8Array, markCacheDirty = false) {
		// console.log("getSharesByHandle(", handle, ")")

		return await this._m.runExclusive(() => this._getSharesByHandle(handle, markCacheDirty))
	}

	async _getSharesByHandle(handle: Uint8Array, markCacheDirty = false): Promise<ShareIndexEntry[]> {
		// console.log("_getSharesByHandle(", handle, ")")

		const shareIndex = await this._getShareIndex(markCacheDirty)

		return shareIndex.shared.filter((share) => share.fileHandles.findIndex((h) => arraysEqual(handle, h)) != -1)
	}

	async share(filesInit: ShareFileMetadataInit[], markCacheDirty = false): Promise<ShareMetadata> {
		// console.log("share(", filesInit, ")")

		return await this._m.runExclusive(() => this._share(filesInit, markCacheDirty))
	}

	async _share(filesInit: ShareFileMetadataInit[], markCacheDirty = false): Promise<ShareMetadata> {
		// console.log("_share(", filesInit, ")")

		const files = await Promise.all(
			filesInit.map(
				async (fileInit): Promise<ShareFileMetadata> => {
					const meta = await this._getFileMetadata(fileInit.location, markCacheDirty)

					return {
						modified: meta.modified,
						uploaded: meta.uploaded,
						name: meta.name,
						path: fileInit.path,
						size: meta.size,
						type: meta.type,
						private: meta.private,
						public: meta.public,
					}
				},
			),
		)

		const locationKey = await entropyToKey(await this.config.metadataAccess.config.crypto.getRandomValues(32))
		const encryptionKey = await this.config.metadataAccess.config.crypto.getRandomValues(32)

		await this.config.metadataAccess.change<ShareIndex>(
			this.indexes.share,
			"Share files",
			(doc) => {
				if (!doc.shared) {
					doc.shared = []
				}
				doc.shared.push({
					locationKey,
					encryptionKey,
					fileHandles: files.map((f) => f.private.handle!).filter(Boolean),
					fileLocations: files.map((f) => f.public.location).filter(Boolean) as Uint8Array[],
				})
			},
			markCacheDirty,
		)

		const shareMeta = await this.config.metadataAccess.changePublic<ShareMetadata>(
			locationKey,
			"Share files",
			(doc) => {
				doc.locationKey = locationKey
				doc.encryptionKey = encryptionKey
				doc.dateShared = Date.now()
				doc.files = files.map((file) => ({
					modified: file.modified,
					name: file.name,
					path: file.path,
					private: {
						handle: file.private.handle,
					},
					public: {
						location: file.public.location,
						shortLinks: file.public.shortLinks,
					},
					size: file.size,
					type: file.type,
					uploaded: file.uploaded,
				}))
			},
			encryptionKey,
			markCacheDirty,
		)

		return unfreezeShareMetadata(shareMeta)
	}

	async getShared(locationKey: Uint8Array, encryptionKey: Uint8Array, markCacheDirty = false): Promise<ShareMetadata> {
		// console.log("getShared(", locationKey, encryptionKey, ")")

		const handle = arrayMerge(locationKey, encryptionKey)

		const shareMeta = await this.config.metadataAccess.getPublic<ShareMetadata>(
			locationKey,
			encryptionKey,
			markCacheDirty,
		)

		if (!shareMeta) {
			throw new AccountSystemNotFoundError("shared", bytesToB64URL(handle))
		}

		return unfreezeShareMetadata(shareMeta)
	}
}
