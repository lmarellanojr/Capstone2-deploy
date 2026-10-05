<#--
  MMDC Cyber Range login frame. Based on Keycloak 25.0.6 base/login/template.ftl:
  the <head>, the kc-* ids, the nested sections ("header", "show-username",
  "form", "socialProviders", "info") and the message/try-another-way logic are
  unchanged, so every Keycloak login page renders inside it. Only the layout
  around them is new: the portal's dark brand panel on the left, the form card
  on the right (stacked on small screens).
-->
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}"<#if realm.internationalizationEnabled> lang="${locale.currentLanguageTag}"<#else> lang="en"</#if>>

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" type="image/png" href="${url.resourcesPath}/img/mmdc-shield.png" />
    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/node_modules/rfc4648/lib/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { checkCookiesAndSetTimer } from "${url.resourcesPath}/js/authChecker.js";

        checkCookiesAndSetTimer(
          "${url.ssoLoginInOtherTabsUrl?no_esc}"
        );
    </script>
</head>

<body class="${properties.kcBodyClass!} cr-body ${bodyClass}">
<div class="cr-shell">

    <aside class="cr-hero">
        <div class="cr-glow cr-glow--top" aria-hidden="true"></div>
        <div class="cr-glow cr-glow--bottom" aria-hidden="true"></div>

        <div class="cr-brand">
            <span class="cr-brand__chip" aria-hidden="true">
                <img src="${url.resourcesPath}/img/mmdc-shield.png" alt="" width="37" height="32">
            </span>
            <span class="cr-brand__text">
                <strong>MMDC Cyber Range</strong>
                <small>Training Platform</small>
            </span>
        </div>

        <div class="cr-hero__body">
            <h2>Learn cybersecurity by doing.</h2>
            <p>Hands-on labs in a private environment &mdash; attack, defend, and watch your progress scored in real time.</p>
            <ul class="cr-highlights">
                <li>
                    <span class="cr-highlights__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    </span>
                    <span><strong>Attacker &amp; defender scenarios</strong><small>Play both sides &mdash; break in, then lock it down.</small></span>
                </li>
                <li>
                    <span class="cr-highlights__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/></svg>
                    </span>
                    <span><strong>Real machines in your browser</strong><small>A live Kali box and targets, in a private lab only you can touch.</small></span>
                </li>
                <li>
                    <span class="cr-highlights__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
                    </span>
                    <span><strong>Scored as you work</strong><small>Milestones are detected automatically, with points and progress.</small></span>
                </li>
            </ul>
        </div>

        <p class="cr-hero__tagline">
            <span>Built for MMDC Network &amp; Cybersecurity students.</span>
            <span>A safe space to learn, practice, grow, and protect.</span>
        </p>
    </aside>

    <main class="cr-main">
      <div class="cr-card">
        <div id="kc-header" class="cr-logo">
            <img src="${url.resourcesPath}/img/mmdc-logo.png" alt="Mapúa Malayan Digital College" width="800" height="694">
            <span id="kc-header-wrapper" class="cr-sr-only">${kcSanitize(msg("loginTitleHtml",(realm.displayNameHtml!'')))?no_esc}</span>
        </div>

        <header class="${properties.kcFormHeaderClass!} cr-header">
            <#if realm.internationalizationEnabled  && locale.supported?size gt 1>
                <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
                    <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                        <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                            <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                            <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                                <#assign i = 1>
                                <#list locale.supported as l>
                                    <li class="${properties.kcLocaleListItemClass!}" role="none">
                                        <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                                    </li>
                                    <#assign i++>
                                </#list>
                            </ul>
                        </div>
                    </div>
                </div>
            </#if>
            <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                <#if displayRequiredFields>
                    <p class="cr-required"><span class="required">*</span> ${msg("requiredFields")}</p>
                </#if>
                <h1 id="kc-page-title"><#nested "header"></h1>
            <#else>
                <#if displayRequiredFields>
                    <p class="cr-required"><span class="required">*</span> ${msg("requiredFields")}</p>
                </#if>
                <#nested "show-username">
                <h1 id="kc-page-title"><#nested "header"></h1>
                <div id="kc-username" class="cr-username">
                    <span class="cr-username__label">Signing in as</span>
                    <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">Not you?</a>
                </div>
            </#if>
        </header>

        <div id="kc-content">
          <div id="kc-content-wrapper">

            <#-- App-initiated actions should not see warning messages about the need to complete the action -->
            <#-- during login.                                                                               -->
            <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                <div class="alert-${message.type} ${properties.kcAlertClass!} pf-m-<#if message.type = 'error'>danger<#else>${message.type}</#if> cr-alert cr-alert--${message.type}" role="alert">
                    <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                </div>
            </#if>

            <#nested "form">

            <#if auth?has_content && auth.showTryAnotherWayLink()>
                <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                    <div class="${properties.kcFormGroupClass!}">
                        <input type="hidden" name="tryAnotherWay" value="on"/>
                        <a href="#" id="try-another-way"
                           onclick="document.forms['kc-select-try-another-way-form'].submit();return false;">${msg("doTryAnotherWay")}</a>
                    </div>
                </form>
            </#if>

            <#nested "socialProviders">

            <#if displayInfo>
                <div id="kc-info" class="${properties.kcSignUpClass!}">
                    <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                        <#nested "info">
                    </div>
                </div>
            </#if>
          </div>
        </div>

        <p class="cr-footnote">Secure sign-in powered by Keycloak</p>
      </div>
    </main>
</div>
</body>
</html>
</#macro>
