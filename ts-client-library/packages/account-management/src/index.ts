import { CryptoMiddleware, NetworkMiddleware } from "@opacity/middleware"
import { extractPromise } from "@opacity/util/src/promise"
import { getPayload } from "@opacity/util/src/payload"
import { bytesToHex } from "@opacity/util/src/hex"
import { bytesToB64URL } from "@opacity/util/src/b64"

export type AccountPlanInfo = {
	name: string
	cost: number
	costInUSD: number
	storageInGB: number
	maxFolders: number
	maxMetadataSizeInMB: number
}

export type AccountPlansRes = {
	plans: {
		[key: number]: AccountPlanInfo
	}
}

export type AccountCreationPayload = {
	durationInMonths: number
	storageLimit: number
}

export type AccountCreationInvoice = {
	cost: number
	ethAddress: string
}

export type AccountCreationRes = {
	expirationDate: number
	invoice: AccountCreationInvoice
}

export type AccountRenewPayload = {
	durationInMonths: number
}

export type AccountRenewStatusPayload = {
	metadataKeys: string[]
	fileHandles: string[]
}

export type AccountRenewInvoice = {
	cost: number
	ethAddress: string
}

export type AccountRenewRes = {
	// expirationDate: number
	opctInvoice: AccountRenewInvoice
}

export type AccountUpgradePayload = {
	storageLimit: number
	durationInMonths: number
}

export type AccountUpgradeStatusPayload = {
	storageLimit: number
	durationInMonths: number
	metadataKeys: string[]
	fileHandles: string[]
}

export type AccountUpgradeInvoice = {
	cost: number
	ethAddress: string
}

export type AccountUpgradeRes = {
	opctInvoice: AccountUpgradeInvoice
}

export type AccountGetData = {
	createdAt: number
	updatedAt: number
	expirationDate: number
	// number of months in their subscription
	monthsInSubscription: number
	// how much storage they are allowed, in GB
	storageLimit: number
	// how much storage they have used, in GB
	storageUsed: number
	// the eth address they will send payment to
	ethAddress: string
	cost: number
	apiVersion: number
	totalFolders: number
	totalMetadataSizeInMB: number
	maxFolders: number
	maxMetadataSizeInMB: number
}

export type AccountGetStripeData = {
	stripePaymentExists: boolean
	chargePaid: boolean
	stripeToken: string
	opctTxStatus: string
	chargeID: string
	amount: number
}

export enum AccountPaymentStatus {
	UNPAID = "unpaid",
	PENDING = "pending",
	PAID = "paid",
	EXPIRED = "expired",
}

export enum AccountRenewStatus {
	INCOMPLETE = "Incomplete",
	PAID = "Success with OPCT",
}

export enum AccountUpgradeStatus {
	INCOMPLETE = "Incomplete",
	PAID = "Success with OPCT",
}

export type AccountGetRes = {
	paymentStatus: keyof Record<AccountPaymentStatus, string>
	error: string
	account: AccountGetData
	stripeData: AccountGetStripeData
	invoice?: AccountCreationInvoice
}

export type AccountRenewStatusRes = {
	status: keyof Record<AccountRenewStatus, string>
}

export type AccountUpgradeStatusRes = {
	status: keyof Record<AccountUpgradeStatus, string>
}

export type AccountSignupArgs = {
	size?: number
	duration?: number
}

export type AccountStripeArgs = {
	stripeToken?: string
}

export type AccountRenewArgs = {
	duration?: number
}

export type AccountUpgradeArgs = {
	size: number
	duration?: number
}

export type AccountRenewStatusArgs = {
	metadataKeys: Uint8Array[]
	fileIDs: Uint8Array[]
}

export type AccountUpgradeStatusArgs = {
	size: number
	duration?: number
	metadataKeys: Uint8Array[]
	fileIDs: Uint8Array[]
}

export type AccountConfig = {
	crypto: CryptoMiddleware
	net: NetworkMiddleware

	storageNode: string
}

export type AccountUpdateAPIVersionPayload = {
	timestamp: number
}

export type AccountUpdateAPIVersionRes = {
	status: string
}

export class Account {
	config: AccountConfig
	_waitingTimer

	get waitingTimer () {
		return this._waitingTimer
	}

	constructor (config: AccountConfig) {
		this.config = config
	}

	async info (): Promise<AccountGetRes> {
		const payload = await getPayload({
			crypto: this.config.crypto,
			payload: {},
		})
		const res = await this.config.net.POST<AccountGetRes>(
			this.config.storageNode + "/api/v1/account-data",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok) {
			throw new Error("Error getting account information: " + JSON.stringify(res.data))
		}

		return res.data
	}

	async updateApiVersion () {
		const payload = await getPayload<AccountUpdateAPIVersionPayload>({
			crypto: this.config.crypto,
			payload: {
				timestamp: Math.floor(Date.now()),
			},
		})
		const res = await this.config.net.POST<AccountUpdateAPIVersionRes>(
			this.config.storageNode + "/api/v2/account/updateApiVersion",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok) {
			throw new Error("Error updating the API Version: " + JSON.stringify(res.data))
		}

		return res.data
	}

	async needsMigration (): Promise<boolean> {
		const {
			account: { apiVersion },
		} = await this.info()

		return apiVersion != 2
	}

	async createSubscription ({ stripeToken = "" }: AccountStripeArgs = {}): Promise<AccountGetRes> {
		const payload = await getPayload({
			crypto: this.config.crypto,
			payload: { stripeToken },
		})
		const res = await this.config.net.POST(
			this.config.storageNode + "/api/v1/stripe/create",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok) {
			throw new Error("Error getting Stripe information: " + JSON.stringify(res.data))
		}

		return res.data
	}

	async plans () {
		const res = await this.config.net.GET(
			this.config.storageNode + "/plans",
			undefined,
			undefined,
			(body) => new Response(body).json() as Promise<AccountPlansRes>,
		)

		// TODO: add filter for custom plans
		// filter plan by size to prevent custom plans from showing up
		const plans: AccountPlanInfo[] = Object.values(res.data.plans).filter((plan) => plan.storageInGB <= 2048)

		return plans
	}

	async status (): Promise<AccountPaymentStatus> {
		const info = await this.info()
		return info.paymentStatus
	}

	async signUp ({ size = 128, duration = 12 }: AccountSignupArgs = {}): Promise<AccountCreationInvoice> {
		try {
			const info = await this.info()

			if (info.invoice) {
				return info.invoice
			}

			if (info.paymentStatus == AccountPaymentStatus.PAID) {
				return {
					cost: 0,
					ethAddress: "",
				}
			}
		} catch {}

		const payload = await getPayload<AccountCreationPayload>({
			crypto: this.config.crypto,
			payload: {
				durationInMonths: duration,
				storageLimit: size,
			},
		})
		const res = await this.config.net.POST<AccountCreationRes>(
			this.config.storageNode + "/api/v1/accounts",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.invoice) {
			throw new Error(`Error getting invoice: ${res.data}`)
		}

		return res.data.invoice
	}

	async waitForPayment (): Promise<void> {
		const [done, resolveDone] = extractPromise<void>()

		let iTime = 2

		const iFn = async () => {
			const status = await this.status()

			if (status == AccountPaymentStatus.PAID) {
				resolveDone()
			}
			else {
				iTime *= 2
				if (iTime > 10) {
					iTime = 10
				}
				this._waitingTimer = setTimeout(iFn, iTime * 1000)
			}
		}

		this._waitingTimer = setTimeout(iFn, iTime)

		await done
	}

	async renewStatus ({ fileIDs, metadataKeys }: AccountRenewStatusArgs): Promise<AccountRenewStatus> {
		const payload = await getPayload<AccountRenewStatusPayload>({
			crypto: this.config.crypto,
			payload: {
				fileHandles: fileIDs.map((id) => bytesToHex(id)),
				metadataKeys: metadataKeys.map((key) => bytesToB64URL(key)),
			},
		})
		const res = await this.config.net.POST<AccountRenewStatusRes>(
			this.config.storageNode + "/api/v1/renew",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.status) {
			throw new Error(`Error getting renewal status ${res.data}`)
		}

		return res.data.status
	}

	async renewAccount ({ duration = 12 }: AccountRenewArgs): Promise<AccountRenewInvoice> {

		const payload = await getPayload<AccountRenewPayload>({
			crypto: this.config.crypto,
			payload: {
				durationInMonths: duration,
			},
		})
		const res = await this.config.net.POST<AccountRenewRes>(
			this.config.storageNode + "/api/v1/renew/invoice",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.opctInvoice) {
			throw new Error(`Error getting renewal invoice ${res.data}`)
		}

		return res.data.opctInvoice
	}

	async waitForRenewPayment (renewStatusArgs: AccountRenewStatusArgs): Promise<void> {
		const [done, resolveDone] = extractPromise<void>()

		let iTime = 2

		const iFn = async () => {
			const status = await this.renewStatus(renewStatusArgs)

			if (status == AccountRenewStatus.PAID) {
				resolveDone()
			}
			else {
				iTime *= 2
				if (iTime > 10) {
					iTime = 10
				}
				this._waitingTimer = setTimeout(iFn, iTime * 1000)
			}
		}

		this._waitingTimer = setTimeout(iFn, iTime)

		await done
	}

	async upgradeStatus ({ size, duration = 12, fileIDs, metadataKeys }: AccountUpgradeStatusArgs): Promise<AccountUpgradeStatus> {
		const payload = await getPayload<AccountUpgradeStatusPayload>({
			crypto: this.config.crypto,
			payload: {
				fileHandles: fileIDs.map((id) => bytesToHex(id)),
				metadataKeys: metadataKeys.map((key) => bytesToB64URL(key)),
				storageLimit: size,
				durationInMonths: duration,
			},
		})
		const res = await this.config.net.POST<AccountUpgradeStatusRes>(
			this.config.storageNode + "/api/v1/upgrade",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.status) {
			throw new Error(`Error getting upgrade status ${res.data}`)
		}

		return res.data.status
	}

	async upgradeAccount ({ size, duration = 12 }: AccountUpgradeArgs): Promise<AccountUpgradeInvoice> {
		const payload = await getPayload<AccountUpgradePayload>({
			crypto: this.config.crypto,
			payload: {
				storageLimit: size,
				durationInMonths: duration,
			},
		})
		const res = await this.config.net.POST<AccountUpgradeRes>(
			this.config.storageNode + "/api/v1/upgrade/invoice",
			undefined,
			JSON.stringify(payload),
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.opctInvoice) {
			throw new Error(`Error getting upgrade invoice ${res.data}`)
		}

		return res.data.opctInvoice
	}

	async waitForUpgradePayment (UpgradeStatusArgs: AccountUpgradeStatusArgs): Promise<void> {
		const [done, resolveDone] = extractPromise<void>()

		let iTime = 2

		const iFn = async () => {
			const status = await this.upgradeStatus(UpgradeStatusArgs)

			if (status == AccountUpgradeStatus.PAID) {
				resolveDone()
			}
			else {
				iTime *= 2
				if (iTime > 10) {
					iTime = 10
				}
				this._waitingTimer = setTimeout(iFn, iTime * 1000)
			}
		}

		this._waitingTimer = setTimeout(iFn, iTime)

		await done
	}

	async cancelWaitForPayment () {
		this._waitingTimer && clearTimeout(this._waitingTimer)
	}

	async getSmartContracts () {
		const res = await this.config.net.GET(
			this.config.storageNode + "/api/v2/smart-contracts",
			undefined,
			undefined,
			(body) => new Response(body).json(),
		)

		if (!res.ok || !res.data?.contracts) {
			throw new Error(`Error getting Smart Contracts ${res.data}`)
		}

		return res.data.contracts
	}
}
