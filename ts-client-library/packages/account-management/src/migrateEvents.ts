import { EventListenerOrEventListenerObject } from "@opacity/util/src/events"

export enum MigratorEvents {
	PERCENT = "percent",
	STATUS = "status",
	DETAILS = "details",
	WARNING = "warning",
	ERROR = "error",
}

type MigratorPercentEventData = { percent: number }
export class MigratorPercentEvent extends CustomEvent<MigratorPercentEvent> {
	constructor (data: MigratorPercentEvent) {
		super(MigratorEvents.PERCENT, { detail: data })
	}
}

type MigratorStatusEventData = { status: string }
export class MigratorStatusEvent extends CustomEvent<MigratorStatusEventData> {
	constructor (data: MigratorStatusEventData) {
		super(MigratorEvents.STATUS, { detail: data })
	}
}

type MigratorDetailsEventData = { details: string }
export class MigratorDetailsEvent extends CustomEvent<MigratorDetailsEventData> {
	constructor (data: MigratorDetailsEventData) {
		super(MigratorEvents.DETAILS, { detail: data })
	}
}

type MigratorWarningEventData = { warning: string }
export class MigratorWarningEvent extends CustomEvent<MigratorWarningEventData> {
	constructor (data: MigratorWarningEventData) {
		super(MigratorEvents.WARNING, { detail: data })
	}
}

type MigratorErrorEventData = { error: string }
export class MigratorErrorEvent extends CustomEvent<MigratorErrorEventData> {
	constructor (data: MigratorErrorEventData) {
		super(MigratorEvents.ERROR, { detail: data })
	}
}

export interface IOpaqueDownloadEvents {
	addEventListener(
		type: MigratorPercentEventData,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: MigratorStatusEventData,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: MigratorEvents.STATUS,
		listener: EventListenerOrEventListenerObject<MigratorStatusEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: MigratorEvents.DETAILS,
		listener: EventListenerOrEventListenerObject<MigratorDetailsEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: MigratorEvents.WARNING,
		listener: EventListenerOrEventListenerObject<MigratorWarningEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: MigratorEvents.ERROR,
		listener: EventListenerOrEventListenerObject<MigratorErrorEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}