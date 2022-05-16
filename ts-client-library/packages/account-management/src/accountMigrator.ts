import { posix } from "path-browserify"

import { MigratorPercentEvent, MigratorStatusEvent, MigratorDetailsEvent, MigratorWarningEvent, MigratorErrorEvent } from "./migrateEvents"

import { MasterHandle } from "../../../../opaque/src/account"
import { FolderMeta } from "../../../../opaque/src/core/account/folder-meta"
import { FileEntryMeta } from "../../../../opaque/src/core/account/file-entry"

import { Account, AccountGetData } from "./index"
import { AccountSystem, AccountSystemNotFoundError, MetadataAccess } from "../../account-system/src"
import { FileSystemObject } from "../../filesystem-access/src/filesystem-object"
import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { WebAccountMiddleware, WebNetworkMiddleware } from "../../middleware-web"
import { bytesToHex, hexToBytes } from "@opacity/util/src/hex"
import { cleanPath } from "@opacity/util/src/path"

export type AccountMigratorConfig = {
	storageNode: string
}

export class AccountMigrator extends EventTarget {
	config: AccountMigratorConfig

	mh: MasterHandle

	account: Account
	accountSystem: AccountSystem
	cryptoMiddleware: CryptoMiddleware
	netMiddleware: NetworkMiddleware
	metadataAccess: MetadataAccess

	_percent = 0
	get percent() {
		return this._percent
	}

	_status = ""
	get status() {
		return this._status
	}

	_details = ""
	get details() {
		return this._details
	}

	constructor(handle: Uint8Array, config: AccountMigratorConfig) {
		super()

		this.config = config

		// v1
		this.mh = new MasterHandle({ handle: bytesToHex(handle) }, {
			downloadOpts: {
				endpoint: config.storageNode,
				autoStart: false,
			},
			uploadOpts: {
				endpoint: config.storageNode,
			}
		})

		// v2
		this.cryptoMiddleware = new WebAccountMiddleware({
			asymmetricKey: handle
		})
		this.netMiddleware = new WebNetworkMiddleware()
		this.metadataAccess = new MetadataAccess({
			crypto: this.cryptoMiddleware,
			net: this.netMiddleware,
			metadataNode: config.storageNode,
		})
		this.account = new Account({
			crypto: this.cryptoMiddleware,
			net: this.netMiddleware,
			storageNode: this.config.storageNode,
		})
		this.accountSystem = new AccountSystem({
			metadataAccess: this.metadataAccess
		})
	}

	async migrate() {
		// TESTING
		this.setStatus("TESTING: Signing up")
		await this.account.signUp({ size: 10 })
		await this.account.waitForPayment()
		// /TESTING

		this.setStatus("Checking if account is still on v1.")
		this.setDetails("Getting v1 root folder.")
		this.setPercent(0)
		try {
			const rootFolderV1 = await this.mh.getFolderMeta("/")
			// console.log(rootFolderV1)
			this.setPercent(2)
		} catch (err) {
			this.dispatchEvent(new MigratorErrorEvent({ error: "Account was already migrated, or has never been initialized." }))

			return
		}

		this.setDetails("")
		this.setStatus("Collecting all folders.")
		const allFolders = await this.collectFolderRecursively("/")
		this.setPercent(15)
		// console.log(allFolders)

		this.setDetails("")
		this.setStatus("Collecting all files.")
		const allFiles = allFolders.map((folder) => folder[1].files.map((file) => [folder[0], file] as [string, FileEntryMeta])).flat()
		// console.log(allFiles, 'allFiles')
		this.setStatus("Migrating folders.")

		try {
			this.setDetails("Initializing v2 root folder.")
			const rootFolderV2 = await this.accountSystem.addFolder("/")
			this.setPercent(30)
			// console.log(rootFolderV2)
		} catch (err) {
			if (err) {
				throw err
			}
		}

		// const folderCount = allFolders.length
		// let folderCnt = 0
		// for (let [path, folderMeta] of allFolders) {
		// 	this.setDetails(`Initializing v2 folder "${path}".`)

		// 	try {
		// 		await this.accountSystem.addFolder(path)
		// 		++folderCnt
		// 		this.setPercent((25 / folderCount * folderCnt + 5).toFixed(0))
		// 	} catch (err) {
		// 		this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while adding folder ("${path}") v2 metadata: ${err}.` }))
		// 	}
		// }

		this.setDetails("")
		// this.setStatus("Counting file sizes.")
		// try {
		// 	const acctInfo = await this.mh.getAccountInfo() as AccountGetData
		// 	const accountedStorageUsed = Math.round(acctInfo.storageUsed * 1000 * 1000 * 1000)
		// 	let totalFileSize = 0
		// 	const fileCount = allFiles.length
		// 	let fileCountingCnt = 0
		// 	for (let [_, fileMetadata] of allFiles) {
		// 		for (let version of fileMetadata.versions) {
		// 			const versionID = version.handle.slice(0, 4) + "..."
		// 			this.setDetails(`Getting file ${versionID} size. Total size counted: ${totalFileSize} bytes.`)

		// 			const downloadUrl = (await (await fetch(
		// 				this.config.storageNode + "/api/v1/download", {
		// 				method: "POST",
		// 				body: JSON.stringify({ fileID: version.handle.slice(0, 64) })
		// 			}
		// 			)).json()).fileDownloadUrl

		// 			const fileSize = +(await fetch(downloadUrl + "/file", { method: "HEAD" })).headers.get("content-length")!
		// 			// file meta size isn't counted
		// 			// const metaSize = +(await fetch(downloadUrl + "/metadata", { method: "HEAD" })).headers.get("content-length")!

		// 			totalFileSize += fileSize // + metaSize
		// 		}
		// 		++fileCountingCnt
		// 		this.setPercent((35 / fileCount * fileCountingCnt + 20).toFixed(0))
		// 	}

		// 	if (accountedStorageUsed != totalFileSize) {
		// 		this.dispatchEvent(new MigratorWarningEvent({ warning: `This account appears to be partially corrupted, because the accounted storage used (${accountedStorageUsed} bytes) does not match the measured file size (${totalFileSize} bytes). The v2 metadata may not be complete. Please look for any inconsistencies.` }))
		// 	}
		// } catch (err) {
		// 	this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while calculating storage used: ${err}.` }))
		// }

		this.setStatus("Migrating files.")

		const fileCount = allFiles.length
		let fileMigratingCnt = 0

		for (let [path, fileMetadata] of allFiles) {
			for (let version of fileMetadata.versions) {
				const versionID = version.handle.slice(0, 4) + "..."
				this.setDetails(`Initializing file ${versionID} ("${fileMetadata.name}") in "${path}".`)

				try {
					try {
						const fileMetadataV2Location = await this.accountSystem.getFileMetadataLocationByFileHandle(hexToBytes(version.handle))

						if (fileMetadataV2Location) {
							const fileMetadata = await this.accountSystem.getFileMetadata(fileMetadataV2Location)

							if (!fileMetadata.finished) {
								await this.accountSystem.finishUpload(fileMetadataV2Location)
							}

							this.dispatchEvent(new MigratorWarningEvent({ warning: `File handle (${versionID}) already exists in v2 metadata. Keeping existing metadata.` }))
						}
					} catch (err) {
						if (err instanceof AccountSystemNotFoundError) {
							const fileHandle = hexToBytes(version.handle)
							const fileLocation = fileHandle.slice(0, 32)
							const fileEncryptionKey = fileHandle.slice(32, 64)

							const fso = new FileSystemObject({
								handle: fileHandle,
								location: undefined,
								config: {
									crypto: this.cryptoMiddleware,
									net: this.netMiddleware,
									storageNode: this.config.storageNode,
								},
							})

							const m = await this.mh.downloadFile(version.handle).downloadMetadata()

							const fileMetadataV2 = await this.accountSystem.addUpload(
								fileLocation,
								fileEncryptionKey,
								path,
								fileMetadata.name,
								{
									lastModified: version.modified || fileMetadata.modified || Date.now(),
									size: m?.size || version.size,
									type: m?.type || "",
								},
								false,
							)

							await this.accountSystem.finishUpload(fileMetadataV2.location)
						} else {
							this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while adding file ${versionID} v2 metadata: ${err}` }))
						}
					}
				} catch (err) {
					this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error for file ${versionID}: ${err}` }))
				}
			}
			++fileMigratingCnt
			this.setPercent((65 / fileCount * fileMigratingCnt + 30).toFixed(0))
		}

		this.setPercent(99)
		await this.account.updateApiVersion()

		this.setDetails("")
		this.setStatus("Finished.")
		this.setPercent(100)
	}

	private async collectFolderRecursively(path: string, out: [string, FolderMeta][] = []) {
		let output = out.slice()
		path = cleanPath(path)

		this.setDetails(`Getting v1 folder "${path}".`)

		try {
			const fm = await this.mh.getFolderMeta(path)

			output = output.concat([[path, fm]])

			for (let f of fm.folders) {
				const subPath = posix.join(path, f.name)
				const subOutPut = await this.collectFolderRecursively(subPath)

				if (subOutPut.length > 0) {
					output = output.concat(subOutPut)
				}
			}
		} catch (err) {
			return []
			// this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while collecting folder ("${path}") v1 metadata: ${err}.` }))
		} finally {
			return output
		}
	}

	private setStatus(status: string) {
		this.dispatchEvent(new MigratorStatusEvent({ status }))
		this._status = status
	}

	private setDetails(details: string) {
		this.dispatchEvent(new MigratorDetailsEvent({ details: details }))
		this._details = details
	}

	private setPercent(percent: number) {
		this.dispatchEvent(new MigratorPercentEvent({ percent }))
		this._percent = percent
	}
}