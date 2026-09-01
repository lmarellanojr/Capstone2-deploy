/** Per-pod OVN subnet — must match provision API `pod_subnet()` / `pod_net.py`. */
export function podSubnetOctet(podId: number): number {
  if (podId < 1 || podId > 6) {
    throw new Error(`pod_id must be 1-6, got ${podId}`)
  }
  return 50 + podId
}

export function podSubnet(podId: number): string {
  return `10.0.${podSubnetOctet(podId)}`
}

export interface PodIps {
  subnet: string
  kali: string
  meta: string
  dvwa: string
}

export function podIps(podId: number): PodIps {
  const base = podSubnet(podId)
  return {
    subnet: `${base}.0/24`,
    kali: `${base}.10`,
    meta: `${base}.20`,
    dvwa: `${base}.30`,
  }
}

/** Rewrite legacy flat-net IPs in scenario markdown for this pod. */
export function injectPodIpsIntoGuide(text: string, podId: number): string {
  const ips = podIps(podId)
  const pad = String(podId).padStart(2, '0')

  return text
    .replace(/\$TARGET_KALI/g, ips.kali)
    .replace(/\$TARGET_META/g, ips.meta)
    .replace(/\$TARGET_DVWA/g, ips.dvwa)
    .replace(/\$TARGET_SUBNET/g, ips.subnet)
    .replace(/10\.0\.30\.0\/24/g, ips.subnet)
    .replace(/10\.0\.30\.20/g, ips.meta)
    .replace(/10\.0\.30\.30/g, ips.dvwa)
    .replace(/10\.0\.20\.10/g, ips.kali)
    .replace(new RegExp(`10\\.0\\.20\\.${100 + podId}`, 'g'), ips.kali)
    .replace(new RegExp(`10\\.0\\.30\\.${200 + podId}`, 'g'), ips.meta)
    .replace(new RegExp(`10\\.0\\.30\\.${100 + podId}`, 'g'), ips.dvwa)
    .replace(/cr-kali-01/g, `cr-kali-${pad}`)
    .replace(/cr-meta3-ubuntu-01/g, `cr-meta3-ubuntu-${pad}`)
    .replace(/cr-dvwa-01/g, `cr-dvwa-${pad}`)
}