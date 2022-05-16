import { EventListenerOrEventListenerObject } from "@opacity/util/src/events"

export enum OpaqueDownloadEvents {
	BLOCK_START = "block-loaded",
	BLOCK_FINISH = "block-finished",
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type OpaqueDownloadBlockStartedEventData = { index: number }
export class OpaqueDownloadBlockStartedEvent extends CustomEvent<OpaqueDownloadBlockStartedEventData> {
	constructor (data: OpaqueDownloadBlockStartedEventData) {
		super(OpaqueDownloadEvents.BLOCK_START, { detail: data })
	}
}
type OpaqueDownloadBlockFinishedEventData = { index: number }
export class OpaqueDownloadBlockFinishedEvent extends CustomEvent<OpaqueDownloadBlockFinishedEventData> {
	constructor (data: OpaqueDownloadBlockFinishedEventData) {
		super(OpaqueDownloadEvents.BLOCK_FINISH, { detail: data })
	}
}

type OpaqueDownloadPartStartedEventData = { index: number }
export class OpaqueDownloadPartStartedEvent extends CustomEvent<OpaqueDownloadPartStartedEventData> {
	constructor (data: OpaqueDownloadPartStartedEventData) {
		super(OpaqueDownloadEvents.PART_START, { detail: data })
	}
}
type OpaqueDownloadPartFinishedEventData = { index: number }
export class OpaqueDownloadPartFinishedEvent extends CustomEvent<OpaqueDownloadPartFinishedEventData> {
	constructor (data: OpaqueDownloadPartFinishedEventData) {
		super(OpaqueDownloadEvents.PART_FINISH, { detail: data })
	}
}

export interface IOpaqueDownloadEvents {
	addEventListener(
		type: OpaqueDownloadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: OpaqueDownloadEvents.BLOCK_START,
		listener: EventListenerOrEventListenerObject<OpaqueDownloadBlockStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: OpaqueDownloadEvents.BLOCK_FINISH,
		listener: EventListenerOrEventListenerObject<OpaqueDownloadBlockFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: OpaqueDownloadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<OpaqueDownloadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: OpaqueDownloadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<OpaqueDownloadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}

export enum OpaqueUploadEvents {
	BLOCK_START = "block-loaded",
	BLOCK_FINISH = "block-finished",
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type OpaqueUploadBlockStartedEventData = { index: number }
export class OpaqueUploadBlockStartedEvent extends CustomEvent<OpaqueUploadBlockStartedEventData> {
	constructor (data: OpaqueUploadBlockStartedEventData) {
		super(OpaqueUploadEvents.BLOCK_START, { detail: data })
	}
}
type OpaqueUploadBlockFinishedEventData = { index: number }
export class OpaqueUploadBlockFinishedEvent extends CustomEvent<OpaqueUploadBlockFinishedEventData> {
	constructor (data: OpaqueUploadBlockFinishedEventData) {
		super(OpaqueUploadEvents.BLOCK_FINISH, { detail: data })
	}
}

type OpaqueUploadPartStartedEventData = { index: number }
export class OpaqueUploadPartStartedEvent extends CustomEvent<OpaqueUploadPartStartedEventData> {
	constructor (data: OpaqueUploadPartStartedEventData) {
		super(OpaqueUploadEvents.PART_START, { detail: data })
	}
}
type OpaqueUploadPartFinishedEventData = { index: number }
export class OpaqueUploadPartFinishedEvent extends CustomEvent<OpaqueUploadPartFinishedEventData> {
	constructor (data: OpaqueUploadPartFinishedEventData) {
		super(OpaqueUploadEvents.PART_FINISH, { detail: data })
	}
}

export interface IOpaqueUploadEvents {
	addEventListener(
		type: OpaqueUploadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: OpaqueUploadEvents.BLOCK_START,
		listener: EventListenerOrEventListenerObject<OpaqueUploadBlockStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: OpaqueUploadEvents.BLOCK_FINISH,
		listener: EventListenerOrEventListenerObject<OpaqueUploadBlockFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: OpaqueUploadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<OpaqueUploadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: OpaqueUploadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<OpaqueUploadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}
