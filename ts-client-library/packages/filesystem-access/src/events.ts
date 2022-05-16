import { FileMeta } from "./filemeta"
import { EventListenerOrEventListenerObject } from "@opacity/util/src/events"

export enum DownloadEvents {
	METADATA = "metadata",
	START = "start",
	FINISH = "finish",
	PROGRESS = "progress",
}

type DownloadMetadataEventData = { metadata: FileMeta }
export class DownloadMetadataEvent extends CustomEvent<DownloadMetadataEventData> {
	constructor (data: DownloadMetadataEventData) {
		super(DownloadEvents.METADATA, { detail: data })
	}
}
type DownloadStartedEventData = { time: number }
export class DownloadStartedEvent extends CustomEvent<DownloadStartedEventData> {
	constructor (data: DownloadStartedEventData) {
		super(DownloadEvents.START, { detail: data })
	}
}
type DownloadFinishedEventData = { start: number; end: number; duration: number; realDuration: number }
export class DownloadFinishedEvent extends CustomEvent<DownloadFinishedEventData> {
	constructor (data: DownloadFinishedEventData) {
		super(DownloadEvents.FINISH, { detail: data })
	}
}
type DownloadProgressEventData = { progress: number }
export class DownloadProgressEvent extends CustomEvent<DownloadProgressEventData> {
	constructor (data: DownloadProgressEventData) {
		super(DownloadEvents.PROGRESS, { detail: data })
	}
}

export interface IDownloadEvents {
	addEventListener(
		type: DownloadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: DownloadEvents.METADATA,
		listener: EventListenerOrEventListenerObject<DownloadMetadataEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: DownloadEvents.START,
		listener: EventListenerOrEventListenerObject<DownloadStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: DownloadEvents.FINISH,
		listener: EventListenerOrEventListenerObject<DownloadFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: DownloadEvents.PROGRESS,
		listener: EventListenerOrEventListenerObject<DownloadProgressEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}

export enum UploadEvents {
	METADATA = "metadata",
	START = "start",
	FINISH = "finish",
	PROGRESS = "progress",
	ERROR = "error",
	CANCEL = "cancel",
}

type UploadMetadataEventData = { metadata: FileMeta }
export class UploadMetadataEvent extends CustomEvent<UploadMetadataEventData> {
	constructor (data: UploadMetadataEventData) {
		super(UploadEvents.METADATA, { detail: data })
	}
}
type UploadStartedEventData = { time: number }
export class UploadStartedEvent extends CustomEvent<UploadStartedEventData> {
	constructor (data: UploadStartedEventData) {
		super(UploadEvents.START, { detail: data })
	}
}
type UploadFinishedEventData = { start: number; end: number; duration: number; realDuration: number }
export class UploadFinishedEvent extends CustomEvent<UploadFinishedEventData> {
	constructor (data: UploadFinishedEventData) {
		super(UploadEvents.FINISH, { detail: data })
	}
}
type UploadProgressEventData = { progress: number }
export class UploadProgressEvent extends CustomEvent<UploadProgressEventData> {
	constructor (data: UploadProgressEventData) {
		super(UploadEvents.PROGRESS, { detail: data })
	}
}
type UploadErrorEventData = { start: number; end: number; error: string }
export class UploadErrorEvent extends CustomEvent<UploadErrorEventData> {
	constructor (data: UploadErrorEventData) {
		super(UploadEvents.ERROR, { detail: data })
	}
}
type UploadCancelEventData = { start: number; end: number; }
export class UploadCancelEvent extends CustomEvent<UploadCancelEventData> {
	constructor (data: UploadCancelEventData) {
		super(UploadEvents.CANCEL, { detail: data })
	}
}

export interface IUploadEvents {
	addEventListener(
		type: UploadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: UploadEvents.METADATA,
		listener: EventListenerOrEventListenerObject<UploadMetadataEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: UploadEvents.START,
		listener: EventListenerOrEventListenerObject<UploadStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: UploadEvents.FINISH,
		listener: EventListenerOrEventListenerObject<UploadFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: UploadEvents.PROGRESS,
		listener: EventListenerOrEventListenerObject<UploadProgressEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: UploadEvents.ERROR,
		listener: EventListenerOrEventListenerObject<UploadErrorEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: UploadEvents.CANCEL,
		listener: EventListenerOrEventListenerObject<UploadCancelEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}

export enum FileSystemObjectEvents {
	DELETE = "delete",
}

type FileSystemObjectDeleteEventData = {}
export class FileSystemObjectDeleteEvent extends CustomEvent<FileSystemObjectDeleteEventData> {
	constructor (data: FileSystemObjectDeleteEventData) {
		super(FileSystemObjectEvents.DELETE, { detail: data })
	}
}

export interface IFileSystemObjectEvents {
	addEventListener(
		type: FileSystemObjectEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: FileSystemObjectEvents.DELETE,
		listener: EventListenerOrEventListenerObject<FileSystemObjectDeleteEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}
