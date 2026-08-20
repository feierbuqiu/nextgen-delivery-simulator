import { describe, expect, it } from 'vitest'

import { isLocalRuntime, renderLocalOnlyBlock } from './localOnly'

describe('本机运行门禁', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])('允许回环主机 %s', (hostname) => {
    expect(isLocalRuntime({ hostname, protocol: 'http:' })).toBe(true)
  })

  it('拒绝公网域名、局域网地址和 file 协议', () => {
    expect(isLocalRuntime({ hostname: 'example.test', protocol: 'https:' })).toBe(false)
    expect(isLocalRuntime({ hostname: '192.168.1.20', protocol: 'http:' })).toBe(false)
    expect(isLocalRuntime({ hostname: '', protocol: 'file:' })).toBe(false)
  })

  it('为被拒绝的运行环境渲染无功能说明', () => {
    const root = document.createElement('div')
    renderLocalOnlyBlock(root)
    expect(root).toHaveTextContent('已阻止非本机运行')
    expect(root).toHaveTextContent('不提供线上服务')
  })
})
