import {
  isAllowedDvwaLabPath,
  isVulnerableDvwaLabPath,
  dvwaContentSecurityPolicy,
  stripDisallowedDvwaMenu,
  DVWA_PREFIX,
} from './dvwaProxy'

describe('dvwaProxy access control', () => {
  describe('isAllowedDvwaLabPath', () => {
    it('allows basic DVWA core paths', () => {
      expect(isAllowedDvwaLabPath('/')).toBe(true)
      expect(isAllowedDvwaLabPath('/index.php')).toBe(true)
      expect(isAllowedDvwaLabPath('/login.php')).toBe(true)
      expect(isAllowedDvwaLabPath('/logout.php')).toBe(true)
      expect(isAllowedDvwaLabPath('/security.php')).toBe(true)
      expect(isAllowedDvwaLabPath('/favicon.ico')).toBe(true)
      expect(isAllowedDvwaLabPath('/dvwa')).toBe(true)
      expect(isAllowedDvwaLabPath('/dvwa/')).toBe(true)
    })

    it('allows SQL injection module paths', () => {
      expect(isAllowedDvwaLabPath('/vulnerabilities/sqli')).toBe(true)
      expect(isAllowedDvwaLabPath('/vulnerabilities/sqli/')).toBe(true)
      expect(isAllowedDvwaLabPath('/vulnerabilities/sqli/?id=1&Submit=Submit')).toBe(true)
      expect(isAllowedDvwaLabPath(`${DVWA_PREFIX}/vulnerabilities/sqli/`)).toBe(true)
    })

    it('allows Reflected XSS module paths', () => {
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_r')).toBe(true)
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_r/')).toBe(true)
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_r/?name=%3Cscript%3Ealert(1)%3C/script%3E')).toBe(true)
      expect(isAllowedDvwaLabPath(`${DVWA_PREFIX}/vulnerabilities/xss_r/`)).toBe(true)
    })

    it('rejects disallowed DVWA modules (stored XSS, DOM XSS, exec, csrf, fi, etc.)', () => {
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_s')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_s/')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_d')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/xss_d/')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/exec')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/csrf')).toBe(false)
      expect(isAllowedDvwaLabPath('/vulnerabilities/fi')).toBe(false)
      expect(isAllowedDvwaLabPath('/setup.php')).toBe(false)
      expect(isAllowedDvwaLabPath('/phpinfo.php')).toBe(false)
    })
  })

  describe('stripDisallowedDvwaMenu', () => {
    it('preserves SQL injection and Reflected XSS menu items while stripping disallowed ones', () => {
      const menuHtml = `
        <ul>
          <li><a href="vulnerabilities/sqli/">SQL Injection</a></li>
          <li><a href="vulnerabilities/xss_r/">XSS (Reflected)</a></li>
          <li><a href="vulnerabilities/xss_s/">XSS (Stored)</a></li>
          <li><a href="vulnerabilities/exec/">Command Injection</a></li>
          <li><a href="vulnerabilities/csrf/">CSRF</a></li>
          <li><a href="security.php">DVWA Security</a></li>
        </ul>
      `
      const stripped = stripDisallowedDvwaMenu(menuHtml)
      expect(stripped).toContain('vulnerabilities/sqli/')
      expect(stripped).toContain('vulnerabilities/xss_r/')
      expect(stripped).toContain('security.php')
      expect(stripped).not.toContain('vulnerabilities/xss_s/')
      expect(stripped).not.toContain('vulnerabilities/exec/')
      expect(stripped).not.toContain('vulnerabilities/csrf/')
    })
  })

  describe('dvwaContentSecurityPolicy & isVulnerableDvwaLabPath', () => {
    const EXPECTED_CSP = 'sandbox allow-scripts allow-forms allow-modals'

    it('identifies SQL injection and Reflected XSS paths as vulnerable', () => {
      expect(isVulnerableDvwaLabPath('/vulnerabilities/sqli')).toBe(true)
      expect(isVulnerableDvwaLabPath('/vulnerabilities/sqli/')).toBe(true)
      expect(isVulnerableDvwaLabPath('/vulnerabilities/sqli/?id=1&Submit=Submit')).toBe(true)
      expect(isVulnerableDvwaLabPath(`${DVWA_PREFIX}/vulnerabilities/sqli/`)).toBe(true)

      expect(isVulnerableDvwaLabPath('/vulnerabilities/xss_r')).toBe(true)
      expect(isVulnerableDvwaLabPath('/vulnerabilities/xss_r/')).toBe(true)
      expect(isVulnerableDvwaLabPath('/vulnerabilities/xss_r/?name=%3Cscript%3Ealert(1)%3C/script%3E')).toBe(true)
      expect(isVulnerableDvwaLabPath(`${DVWA_PREFIX}/vulnerabilities/xss_r/`)).toBe(true)
    })

    it('identifies non-vulnerable paths as not vulnerable', () => {
      expect(isVulnerableDvwaLabPath('/')).toBe(false)
      expect(isVulnerableDvwaLabPath('/index.php')).toBe(false)
      expect(isVulnerableDvwaLabPath('/login.php')).toBe(false)
      expect(isVulnerableDvwaLabPath('/security.php')).toBe(false)
      expect(isVulnerableDvwaLabPath('/favicon.ico')).toBe(false)
      expect(isVulnerableDvwaLabPath('/dvwa/css/main.css')).toBe(false)
    })

    it('returns sandbox CSP header for vulnerable modules', () => {
      expect(dvwaContentSecurityPolicy('/vulnerabilities/xss_r')).toBe(EXPECTED_CSP)
      expect(dvwaContentSecurityPolicy('/vulnerabilities/xss_r/')).toBe(EXPECTED_CSP)
      expect(dvwaContentSecurityPolicy('/vulnerabilities/xss_r/?name=<script>alert(1)</script>')).toBe(EXPECTED_CSP)
      expect(dvwaContentSecurityPolicy('/vulnerabilities/sqli')).toBe(EXPECTED_CSP)
      expect(dvwaContentSecurityPolicy('/vulnerabilities/sqli/')).toBe(EXPECTED_CSP)
    })

    it('returns null CSP for safe pages so portal origin is preserved', () => {
      expect(dvwaContentSecurityPolicy('/')).toBeNull()
      expect(dvwaContentSecurityPolicy('/security.php')).toBeNull()
      expect(dvwaContentSecurityPolicy('/login.php')).toBeNull()
      expect(dvwaContentSecurityPolicy('/favicon.ico')).toBeNull()
      expect(dvwaContentSecurityPolicy('/dvwa/css/main.css')).toBeNull()
    })
  })
})
