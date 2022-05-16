import { EventListenerOrEventListenerObject } from "@opacity/util/src/events"

export enum TransparentDownloadEvents {
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type TransparentDownloadPartStartedEventData = { index: number }
export class TransparentDownloadPartStartedEvent extends CustomEvent<TransparentDownloadPartStartedEventData> {
	constructor (data: TransparentDownloadPartStartedEventData) {
		super(TransparentDownloadEvents.PART_START, { detail: data })
	}
}
type TransparentDownloadPartFinishedEventData = { index: number }
export class TransparentDownloadPartFinishedEvent extends CustomEvent<TransparentDownloadPartFinishedEventData> {
	constructor (data: TransparentDownloadPartFinishedEventData) {
		super(TransparentDownloadEvents.PART_FINISH, { detail: data })
	}
}

export interface ITransparentDownloadEvents {
	addEventListener(
		type: TransparentDownloadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: TransparentDownloadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<TransparentDownloadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: TransparentDownloadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<TransparentDownloadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}

export enum TransparentUploadEvents {
	PART_START = "part-loaded",
	PART_FINISH = "part-finished",
}

type TransparentUploadPartStartedEventData = { index: number }
export class TransparentUploadPartStartedEvent extends CustomEvent<TransparentUploadPartStartedEventData> {
	constructor (data: TransparentUploadPartStartedEventData) {
		super(TransparentUploadEvents.PART_START, { detail: data })
	}
}
type TransparentUploadPartFinishedEventData = { index: number }
export class TransparentUploadPartFinishedEvent extends CustomEvent<TransparentUploadPartFinishedEventData> {
	constructor (data: TransparentUploadPartFinishedEventData) {
		super(TransparentUploadEvents.PART_FINISH, { detail: data })
	}
}

export interface ITransparentUploadEvents {
	addEventListener(
		type: TransparentUploadEvents,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: TransparentUploadEvents.PART_START,
		listener: EventListenerOrEventListenerObject<TransparentUploadPartStartedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: TransparentUploadEvents.PART_FINISH,
		listener: EventListenerOrEventListenerObject<TransparentUploadPartFinishedEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}
