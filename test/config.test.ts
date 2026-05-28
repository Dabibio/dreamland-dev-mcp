import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('returns config when DREAMLAND_TOKEN and DREAMLAND_API_BASE both valid', () => {
    const cfg = loadConfig({
      DREAMLAND_TOKEN: 'dl_live_abcdef123',
      DREAMLAND_API_BASE: 'http://localhost:8080',
    })
    expect(cfg.token).toBe('dl_live_abcdef123')
    expect(cfg.apiBase).toBe('http://localhost:8080')
  })

  it('defaults apiBase to http://localhost:8080 when not provided', () => {
    const cfg = loadConfig({ DREAMLAND_TOKEN: 'dl_live_xyz' })
    expect(cfg.apiBase).toBe('http://localhost:8080')
  })

  it('strips trailing slashes from apiBase', () => {
    const cfg = loadConfig({
      DREAMLAND_TOKEN: 'dl_live_xyz',
      DREAMLAND_API_BASE: 'https://api.example.com///',
    })
    expect(cfg.apiBase).toBe('https://api.example.com')
  })

  it('rejects missing token', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({ DREAMLAND_TOKEN: '' })).toThrow(/required/)
    expect(() => loadConfig({ DREAMLAND_TOKEN: '   ' })).toThrow(/required/)
  })

  it('rejects token without dl_live_ prefix', () => {
    expect(() => loadConfig({ DREAMLAND_TOKEN: 'something-else' })).toThrow(/dl_live_/)
  })

  it('rejects apiBase without http(s) scheme', () => {
    expect(() =>
      loadConfig({ DREAMLAND_TOKEN: 'dl_live_xyz', DREAMLAND_API_BASE: 'api.example.com' }),
    ).toThrow(/http/)
  })
})
