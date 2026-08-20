export interface RuntimeLocation {
  hostname: string
  protocol: string
}

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function isLocalRuntime(location: RuntimeLocation): boolean {
  return (
    (location.protocol === 'http:' || location.protocol === 'https:') &&
    LOCAL_HOSTNAMES.has(location.hostname.toLocaleLowerCase())
  )
}

export function renderLocalOnlyBlock(root: HTMLElement): void {
  document.title = '已阻止非本机运行'

  const main = document.createElement('main')
  main.setAttribute('role', 'alert')
  main.style.cssText = [
    'box-sizing:border-box',
    'max-width:42rem',
    'margin:10vh auto',
    'padding:2rem',
    'font-family:system-ui,sans-serif',
    'line-height:1.7',
    'border:1px solid #b8bec8',
    'border-radius:1rem',
  ].join(';')

  const heading = document.createElement('h1')
  heading.textContent = '已阻止非本机运行'
  const explanation = document.createElement('p')
  explanation.textContent = '本工具仅允许在 127.0.0.1、localhost 或本机 IPv6 回环地址运行，不提供线上服务。'
  const privacy = document.createElement('p')
  privacy.textContent = '请勿在任何环境录入真实个人信息、业务号码、账号或凭据。'

  main.append(heading, explanation, privacy)
  root.replaceChildren(main)
}
