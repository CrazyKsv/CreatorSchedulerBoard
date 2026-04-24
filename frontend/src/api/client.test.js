import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, authApi, postsApi } from './client'

describe('api', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('sends JSON body and Content-Type header', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    })
    await api('/test', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: '{"foo":"bar"}',
      })
    )
  })

  it('adds Authorization header when token in localStorage', async () => {
    localStorage.setItem('token', 'secret')
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    await api('/posts')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      })
    )
  })

  it('throws with message from detail when response not ok', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Email already registered' }),
    })
    await expect(api('/auth/register', { method: 'POST', body: '{}' })).rejects.toThrow(
      'Email already registered'
    )
  })

  it('on 401 removes token and throws Unauthorized', async () => {
    localStorage.setItem('token', 'x')
    const hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', { value: { get href() { return '' }, set href(v) { hrefSetter(v) } }, writable: true })
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })
    await expect(api('/posts')).rejects.toThrow('Unauthorized')
    expect(localStorage.getItem('token')).toBeNull()
    expect(hrefSetter).toHaveBeenCalledWith('/login')
  })
})

describe('authApi', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('login sends POST to /auth/login with email and password', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok', token_type: 'bearer' }),
    })
    await authApi.login('a@b.com', 'pass')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.com', password: 'pass' }),
      })
    )
  })

  it('register sends POST to /auth/register with data', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, email: 'u@x.com' }),
    })
    await authApi.register({ email: 'u@x.com', password: 'p', full_name: 'U' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/register'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'u@x.com', password: 'p', full_name: 'U' }),
      })
    )
  })
})

describe('postsApi', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('list builds query string from params', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    })
    await postsApi.list({ status: 'draft', platform: 'youtube' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\?.*status=draft.*platform=youtube|platform=youtube.*status=draft/),
      expect.any(Object)
    )
  })

  it('create sends POST with body', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, title: 'T', platform: 'youtube' }),
    })
    await postsApi.create({ title: 'T', platform: 'youtube', status: 'draft' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/posts'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'T', platform: 'youtube', status: 'draft' }),
      })
    )
  })
})
