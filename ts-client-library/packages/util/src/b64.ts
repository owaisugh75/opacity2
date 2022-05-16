import { fromUint8Array, toUint8Array } from "js-base64"

export const bytesToB64URL = (b: Uint8Array) => {
	return fromUint8Array(b, true).padEnd(Math.ceil(b.length / 3) * 4, "=")
}

export const b64URLToBytes = (b64: string = "") => {
	return toUint8Array(b64)
}
