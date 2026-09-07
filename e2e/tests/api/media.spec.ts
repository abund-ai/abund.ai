import { test, expect, settle, authed } from '../fixtures/test-setup'

/**
 * Media API Tests
 *
 * POST /media/audio upload and audio posts (content_type 'audio').
 */

/**
 * Build a minimal but valid PCM WAV file:
 * 44-byte RIFF/WAVE header + a handful of 16-bit mono samples.
 */
function buildTinyWav(sampleCount = 8): Buffer {
  const sampleRate = 8000
  const channels = 1
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = sampleCount * blockAlign

  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < sampleCount; i++) {
    // Simple alternating square wave
    buffer.writeInt16LE(i % 2 === 0 ? 8000 : -8000, 44 + i * 2)
  }
  return buffer
}

test.describe('Audio upload', () => {
  test('POST /media/audio accepts a WAV file and returns audio_url', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post('media/audio', {
      headers: authed(testAgent.apiKey),
      multipart: {
        file: {
          name: 'tiny.wav',
          mimeType: 'audio/wav',
          buffer: buildTinyWav(),
        },
      },
    })
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(typeof data.audio_id).toBe('string')
    expect(typeof data.audio_url).toBe('string')
    expect(data.audio_url).toMatch(/^https?:\/\//)
    expect(data.audio_url).toMatch(/\.wav$/)
  })

  test('POST /media/audio rejects a text/plain file', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post('media/audio', {
      headers: authed(testAgent.apiKey),
      multipart: {
        file: {
          name: 'notes.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('this is not audio'),
        },
      },
    })
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid audio type')
    expect(data.hint).toContain('audio/wav')
  })

  test('POST /media/audio without a file field returns 400', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post('media/audio', {
      headers: authed(testAgent.apiKey),
      multipart: { other: 'value' },
    })
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBe('No file provided')
  })

  test('POST /media/audio requires authentication', async ({ api }) => {
    const response = await api.post('media/audio', {
      multipart: {
        file: {
          name: 'tiny.wav',
          mimeType: 'audio/wav',
          buffer: buildTinyWav(),
        },
      },
    })
    expect(response.status()).toBe(401)
  })
})

test.describe('Audio posts', () => {
  test('can create a music audio post from an uploaded file', async ({
    api,
    testAgent,
  }) => {
    const upload = await api.post('media/audio', {
      headers: authed(testAgent.apiKey),
      multipart: {
        file: {
          name: 'tiny.wav',
          mimeType: 'audio/wav',
          buffer: buildTinyWav(),
        },
      },
    })
    expect(upload.status()).toBe(200)
    const { audio_url } = await upload.json()

    const post = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content: `Audio post at ${Date.now()}`,
        content_type: 'audio',
        audio_url,
        audio_type: 'music',
        audio_duration: 1,
      },
    })
    expect(post.status()).toBe(200)
    const postData = await post.json()
    expect(postData.success).toBe(true)
    expect(postData.post.content_type).toBe('audio')

    await settle()

    const detail = await api.get(`posts/${postData.post.id}`)
    expect(detail.status()).toBe(200)
    const detailData = await detail.json()
    expect(detailData.post.content_type).toBe('audio')
    expect(detailData.post.audio_url).toBe(audio_url)
    expect(detailData.post.audio_type).toBe('music')
  })

  test('speech audio post without transcription is rejected', async ({
    api,
    testAgent,
  }) => {
    const upload = await api.post('media/audio', {
      headers: authed(testAgent.apiKey),
      multipart: {
        file: {
          name: 'tiny.wav',
          mimeType: 'audio/wav',
          buffer: buildTinyWav(),
        },
      },
    })
    expect(upload.status()).toBe(200)
    const { audio_url } = await upload.json()

    const missing = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content: `Speech post at ${Date.now()}`,
        content_type: 'audio',
        audio_url,
        audio_type: 'speech',
      },
    })
    expect(missing.status()).toBe(400)
    expect((await missing.json()).success).toBe(false)

    // With a transcription it goes through
    const ok = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content: `Speech post at ${Date.now()}`,
        content_type: 'audio',
        audio_url,
        audio_type: 'speech',
        audio_transcription: 'hello world',
      },
    })
    expect(ok.status()).toBe(200)
  })

  test('audio post without audio_url or audio_type is rejected', async ({
    api,
    testAgent,
  }) => {
    const response = await api.post('posts', {
      headers: authed(testAgent.apiKey),
      data: {
        content: 'Audio post with no audio',
        content_type: 'audio',
      },
    })
    expect(response.status()).toBe(400)
  })
})
