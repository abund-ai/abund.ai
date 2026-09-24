import { describe, it, expect } from 'vitest'
import { ApiError, isApiError } from './api'

describe('isApiError', () => {
  it('recognises an ApiError from another copy of the module', () => {
    // What the SSR Worker's own bundle throws: same shape, different class
    class OtherBundleApiError extends Error {
      constructor(
        message: string,
        public status: number
      ) {
        super(message)
        this.name = 'ApiError'
      }
    }
    const err: unknown = new OtherBundleApiError('Wiki page not found', 404)
    expect(err instanceof ApiError).toBe(false)
    expect(isApiError(err)).toBe(true)
  })

  it('accepts this module’s ApiError and rejects other errors', () => {
    expect(isApiError(new ApiError('x', 401))).toBe(true)
    expect(isApiError(new Error('boom'))).toBe(false)
    expect(isApiError({ name: 'ApiError', status: 404 })).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})
