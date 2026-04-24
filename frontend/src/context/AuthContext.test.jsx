import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

// Mock the API client so we don't hit the network
vi.mock('../api/client', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
  },
}))

const { authApi } = await import('../api/client')

function TestConsumer() {
  const { user, loading, login, register, logout } = useAuth()
  if (loading) return <div>Loading</div>
  return (
    <div>
      <span data-testid="user">{user ? 'logged-in' : 'logged-out'}</span>
      <button type="button" onClick={() => login('a@b.com', 'pass')}>
        Login
      </button>
      <button type="button" onClick={() => register({ email: 'a@b.com', password: 'p' })}>
        Register
      </button>
      <button type="button" onClick={logout}>
        Logout
      </button>
    </div>
  )
}

describe('AuthContext', () => {
  const originalLocalStorage = globalThis.localStorage
  beforeEach(() => {
    vi.clearAllMocks()
    let store = {}
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v }),
      removeItem: vi.fn((k) => { delete store[k] }),
      clear: vi.fn(() => { store = {} }),
      length: 0,
      key: vi.fn(),
    }
  })
  afterEach(() => {
    globalThis.localStorage = originalLocalStorage
  })

  it('ends as logged-out when no token in localStorage', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )
    await act(async () => {})
    expect(screen.getByTestId('user')).toHaveTextContent('logged-out')
  })

  it('shows logged-in when token exists in localStorage', async () => {
    globalThis.localStorage.getItem = vi.fn((k) => (k === 'token' ? 'abc' : null))
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )
    await act(async () => {})
    expect(screen.getByTestId('user')).toHaveTextContent('logged-in')
  })

  it('login calls authApi.login and stores token', async () => {
    authApi.login.mockResolvedValue({ access_token: 'new-token' })
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )
    await act(async () => {})
    await act(async () => {
      screen.getByText('Login').click()
    })
    expect(authApi.login).toHaveBeenCalledWith('a@b.com', 'pass')
    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('token', 'new-token')
    expect(screen.getByTestId('user')).toHaveTextContent('logged-in')
  })

  it('logout clears user and removes token', async () => {
    globalThis.localStorage.getItem = vi.fn((k) => (k === 'token' ? 'x' : null))
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )
    await act(async () => {})
    expect(screen.getByTestId('user')).toHaveTextContent('logged-in')
    await act(async () => {
      screen.getByText('Logout').click()
    })
    expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith('token')
    expect(screen.getByTestId('user')).toHaveTextContent('logged-out')
  })

  it('useAuth throws when used outside AuthProvider', () => {
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used within AuthProvider')
  })
})
