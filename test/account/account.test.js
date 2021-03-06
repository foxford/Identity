/* eslint promise/no-callback-in-promise: 0 */
import 'isomorphic-fetch'
import Debug from 'debug'
import fetchMock from 'fetch-mock'
import tap from 'tap'

import { Account } from '../../src/account'
import { IdP } from '../../src/idp'
import { name } from '../../package.json'

import {
  audience,
  tokenData,
  account_label,
  accountResponse,
  refreshResponse,
} from '../response.mock'

global.self = global
// bind global to self for the fetch polyfill
require('whatwg-fetch') // eslint-disable-line node/no-unpublished-require

const debug = Debug(`${name}:account`)

const meModeLabel = 'maybe_account_label'

function ClosureStorage (initialState) {
  this.storage = initialState || {}

  this.setItem = (key, value) => {
    if (typeof value !== 'string') throw new TypeError('Wrong value format')
    this.storage[key] = value
  }

  this.getItem = key => this.storage[key]

  this.removeItem = (key) => {
    delete this.storage[key]
  }
}

const getAccount = (opts = {}, store) => {
  debug('Create account instance')

  const options = (opts.account || {
    audience,
    requestMode: 'label',
    label: meModeLabel,
  })

  debug('Initialize account with options:', options)

  return new Account(
    options,
    new IdP(opts.provider || { endpoint: 'https://mock-host' }),
    store || new ClosureStorage()
  )
}

const fetchMocks = ({
  account,
  label,
  action: action = 'refresh',
  response = refreshResponse,
}) => {
  fetchMock.mock(`${account.provider.authnEndpoint}/${label}`, {
    body: accountResponse,
    status: 200,
  }, {
    method: 'GET',
  })

  fetchMock.mock(`${account.provider.accountEndpoint}/${label}/${action}`, {
    body: response,
  }, {
    methods: 'POST',
  })
}

tap.test('Account', (t) => {
  t.test('construct', (test) => {
    const idp = new IdP({ endpoint: 'https://mock-host' })

    Account.fetchLabel(tokenData, idp)
      .then(({ id: acc_label }) => {
        const acc = new Account(
          {
            audience,
            label: acc_label,
          },
          idp,
          new ClosureStorage()
        )

        tap.not(acc, undefined)
        tap.same(acc.id, `${account_label}.${audience}`)
        tap.same(acc.label, account_label)
        tap.same(acc.requestMode, 'id')
        tap.same(acc._requestLabel(), `${account_label}.${audience}`)

        return undefined
      })
      .catch(tap.error)

    let account = getAccount({
      account: {
        label: 'account_label',
        requestMode: 'label',
        audience,
      },
    })

    tap.not(account, undefined)
    tap.same(account.id, `${account_label}.${audience}`)
    tap.same(account.label, account_label)
    tap.same(account.requestMode, 'label')
    tap.same(account._requestLabel(), account_label)

    account = getAccount({
      account: {
        label: 'account_label',
        requestMode: 'id',
        audience,
      },
    })

    tap.not(account, undefined)
    tap.same(account.id, `${account_label}.${audience}`)
    tap.same(account.label, account_label)
    tap.same(account.requestMode, 'id')
    tap.same(account._requestLabel(), `${account_label}.${audience}`)

    tap.throws(() => {
      getAccount({
        account: {},
      })
    }, { message: '`audience` is absent' })

    tap.throws(() => {
      getAccount({
        account: {
          label: 'you',
          requestMode: 'label',
        },
      })
    }, { message: '`audience` is absent' })

    tap.throws(() => {
      getAccount({
        account: {
          requestMode: 'label',
          audience,
        },
      })
    }, { message: '`label` is absent' })

    tap.throws(() => {
      getAccount({
        account: {
          requestMode: 'id',
          audience,
        },
      })
    }, { message: '`label` is absent' })

    test.end()
  })

  t.end()
})

tap.test('Account', (t) => {
  t.test('load void from empty storage', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    acc.load()
      .catch((error) => {
        tap.same(error.message, 'Could not load data')
        test.end()
      })
  })

  t.test('load void from not empty storage', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    strg.setItem(acc.id, '{"a":123}')

    acc.load()
      .then((data) => {
        tap.same(data, { a: 123 })

        return test.end()
      })
      .catch(tap.error)
  })

  t.test('remove void from empty storage', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    acc.remove()
      .catch((error) => {
        tap.same(error.message, 'Could not load data')
        test.end()
      })
  })

  t.test('remove void from not empty storage', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    strg.setItem(acc.id, '{"a":123}')

    acc.remove()
      .then((data) => {
        tap.same(data, { a: 123 })
        tap.same(strg.getItem(acc.id, undefined))

        return test.end()
      })
      .catch(tap.error)
  })

  t.test('load failed as expected', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    strg.setItem(acc.id, '"')

    tap.throws(acc.load)

    test.end()
  })

  t.test('load is ok for valid JSON', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    strg.setItem(acc.id, '{"a":"123"}')

    acc.load()
      .then((data) => {
        tap.same(data, { a: 123 })

        return test.end()
      })
      .catch(tap.error)
  })

  t.test('store a token with incomplete data', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    tap.throws(() => {
      acc.store()
    }, { message: '`token` is absent' })

    tap.throws(() => {
      acc.store({})
    }, { message: '`access_token` is absent' })

    tap.throws(() => {
      acc.store({
        refresh_token: undefined,
      })
    }, { message: '`access_token` is absent' })

    tap.throws(() => {
      acc.store({
        access_token: tokenData.access_token,
        refresh_token: undefined,
      })
    }, { message: '`refresh_token` is absent' })

    acc.store({
      access_token: tokenData.access_token,
    })
      .then((data) => {
        tap.same(data, {
          access_token: tokenData.access_token,
          refresh_token: undefined,
          expires_time: 0,
        })

        return undefined
      })
      .catch(tap.error)

    acc.store({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    })
      .then((data) => {
        tap.same(data, {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_time: 0,
        })

        return undefined
      })
      .catch(tap.error)

    test.end()
  })

  t.test('store a token with expiration_time', (test) => {
    const strg = new ClosureStorage()
    const acc = getAccount({}, strg)

    acc.store({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_time: 1552992914509,
    })
      .then((data) => {
        tap.same(data, {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_time: 1552992914509,
        })

        return test.end()
      })
      .catch(tap.error)
  })

  t.end()
})

tap.test('Account', (t) => {
  const strg = new ClosureStorage()
  const account = getAccount({
    account: {
      audience,
      label: 'me',
      requestMode: 'label',
    },
  }, strg)

  fetchMocks({
    account, label: 'me',
  })

  t.test('`store` is ok', (test) => {
    const _now = global.Date.now
    const sometime = _now()

    global.Date.now = () => sometime

    account.store({
      ...tokenData,
      expires_time: sometime,
    })
      .then((_) => {
        tap.same(JSON.stringify(_), account.storage.getItem(account.id))
        tap.same(_, {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_time: sometime,
        })

        return undefined
      })
      .finally(() => {
        global.Date.now = _now
        test.end()
      })
      .catch(tap.error)
  })

  t.test('`tokenData` successful response', (test) => {
    const _now = global.Date.now
    const sometime = _now()

    global.Date.now = () => sometime

    account.store({
      ...tokenData,
      expires_time: 0,
    })
      .then(() => account.tokenData())
      .then((_) => {
        tap.same(JSON.stringify(_), account.storage.getItem(account.id))
        tap.same(_, {
          access_token: refreshResponse.access_token,
          refresh_token: tokenData.refresh_token,
          expires_time: sometime + refreshResponse.expires_in * 1e3,
        })

        return undefined
      })
      .finally(() => {
        global.Date.now = _now
        test.end()
      })
      .catch(tap.error)
  })

  t.end()
})
