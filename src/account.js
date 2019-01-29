/** @flow */
import type { IdP } from './idp'
import type { IAbstractStorage as AbstractStorage } from './storage.js.flow'
import type { AccountConfig, TokenData } from './account.js.flow'
import { fetchRetry } from './utils/index'

type EndpointConfig = {
  endpoint: string,
  accountEndpoint?: string | Function,
  authnEndpoint?: string | Function
}

const MAX_AJAX_RETRY = 3
const AJAX_RETRY_DELAY = 1000
const LEEWAY = 3000

const validResponse = (response: Response): Response => {
  if (response.status && response.status >= 200 && response.status < 300) {
    return response
  }

  throw new Error(response.statusText || `Invalid request. Status: ${response.status}`)
}

const parsedResponse = (response: Response): Promise<Object> => {
  if (!response) throw new TypeError(`Missing 'response': ${response}`)

  try {
    return response.json()
  } catch (error) {
    throw new Error('Response is not a JSON')
  }
}

const parse = (fn): Promise<*> => {
  const it = typeof fn === 'function' ? fn() : fn
  if (typeof it !== 'string') throw new TypeError('Can not parse')

  return Promise.resolve(JSON.parse(it))
}

export default class Account<Config: AccountConfig, Storage: AbstractStorage> {
  fetchFn: Function;

  fetchOpts: Object;

  id: string;

  label: string;

  leeway: number;

  legacyLabel: boolean | void;

  provider: IdP<EndpointConfig>;

  retries: number;

  retryDelay: number;

  storage: Storage;

  constructor (config: Config, storage: Storage) {
    if (!config || !config.provider) throw new TypeError('Missing `provider` in config')

    if (!storage) throw new TypeError('Storage is not defined')

    this.storage = storage
    this.provider = config.provider
    this.fetchFn = fetchRetry
    this.fetchOpts = {
      delay: config.retryDelay || AJAX_RETRY_DELAY,
      retries: config.retries || MAX_AJAX_RETRY,
    }
    this.retries = config.retries || MAX_AJAX_RETRY
    this.retryDelay = config.retryDelay || AJAX_RETRY_DELAY
    this.leeway = config.leeway || LEEWAY
    this.legacyLabel = config.legacyLabel || false

    const { id, label } = this._createLabel(config.audience, config.label)

    this.label = label
    this.id = id

    if (!this.id) throw new TypeError('Failed to configure account. Id is not present')
  }

  // eslint-disable-next-line class-methods-use-this
  _createLabel (audience: string, label: string = 'me', separator: string = '.'): { label: string, id: string } {
    if (!audience) throw new TypeError('`audience` is absent')

    return {
      label,
      id: `${label}${separator}${audience}`,
    }
  }

  _requestLabel (): string {
    return this.legacyLabel ? this.label : this.id
  }

  load (authKey: string = ''): Promise<Object> {
    const label = authKey || this.id
    if (!label) return Promise.reject(new TypeError('`label` is absent'))

    return Promise.resolve(() => this.storage.getItem(this.id)).then(parse)
  }

  remove (): Promise<mixed> {
    if (!this.id) return Promise.reject(new TypeError('`id` is absent'))

    return Promise.resolve(this.storage.getItem(this.id))
  }

  store (data: TokenData): Promise<mixed> {
    if (!this.id) return Promise.reject(new TypeError('`id` is absent'))

    const { id } = this

    return Promise.resolve(data)
      .then((_) => {
        if (!this.id) return Promise.reject(new TypeError('`id` is absent'))

        if (!_.expires_in) return _
        // bypass token unless `expires_in` is not present

        const expin = Number(_.expires_in)
        if (isNaN(expin)) throw new TypeError('Wrong `expires_in` value')

        return ({ ..._, expires_time: (Number(_.expires_in) || 0) * 1e3 })
      })
      .then((_) => {
        this.storage.setItem(id, JSON.stringify(_))

        return _
      })
  }

  account (authKey: string = ''): Promise<TokenData> {
    const label = authKey || this.id

    return this.accessToken(label)
      .then((data: TokenData) => {
        const { access_token } = data

        return this.provider.account(this._requestLabel(), access_token)
      })
      .then(req => this.fetchFn(() => req, this.fetchOpts))
      .then(validResponse)
      .then(parsedResponse)
  }

  accessToken (authKey: string = ''): Promise<*> {
    const label = authKey || this.id

    type TRefreshReponse = { access_token: string, expires_in: number, token_type: string }

    return this.load(label)
      .then((maybeValidTokens: TokenData) => {
        const isExpired = this._isTokenExpired(maybeValidTokens)

        if (!isExpired) return maybeValidTokens

        const { refresh_token } = maybeValidTokens

        return this.provider.refreshAccessToken(this._requestLabel(), refresh_token)
      })
      .then((req: TRequest) => this.fetchFn(() => req, this.fetchOpts))
      .then(validResponse)
      .then((_): TRefreshReponse => parsedResponse(_))
      // eslint-disable-next-line promise/no-nesting
      .then(_ => this.load(label)
        .then(old => this.store({
          ...old,
          access_token: _.access_token,
          expires_in: _.expires_in,
        })))
  }

  revokeRefreshToken (authKey: string = ''): Promise<*> {
    const label = authKey || this.id

    type TRevokeResponse = { refresh_token: string }

    return this.load(label)
      .then((maybeToken) => {
        const { refresh_token } = maybeToken

        return this.provider.revokeRefreshToken(this._requestLabel(), refresh_token)
      })
      .then((req: TRequest) => this.fetchFn(() => req, this.fetchOpts))
      .then(validResponse)
      .then((_): TRevokeResponse => parsedResponse(_))
      // eslint-disable-next-line promise/no-nesting
      .then(_ => this.load(label)
        .then(old => this.store({
          ...old,
          refresh_token: _.refresh_token,
        })))
  }

  /**
   * Check token expire
   */
  _isTokenExpired (data: TokenData): boolean {
    const isExpired = x => !x
    || !x.expires_time
    || Date.now() > (Number(x.expires_time) - this.leeway)

    return isExpired(data)
  }
}

export { Account }
