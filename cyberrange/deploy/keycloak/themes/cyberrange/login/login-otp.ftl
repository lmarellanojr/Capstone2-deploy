<#--
  One-time code at sign-in. Based on Keycloak 25.0.6 base/login/login-otp.ftl:
  same form id/action, same field names (otp, selectedCredentialId, login),
  same error handling. New: title + instructions, a numeric one-time-code
  input, and a lost-phone hint.
-->
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('totp'); section>
    <#if section="header">
        ${msg("crOtpTitle")}
    <#elseif section="form">
        <div class="cr-step-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/><path d="m9.5 10 2 2 3.5-3.5"/></svg>
        </div>
        <p class="cr-intro">${msg("crOtpIntro")}</p>

        <form id="kc-otp-login-form" class="${properties.kcFormClass!}" action="${url.loginAction}"
            method="post">
            <#if otpLogin.userOtpCredentials?size gt 1>
                <div class="${properties.kcFormGroupClass!} cr-devices">
                    <#list otpLogin.userOtpCredentials as otpCredential>
                        <input id="kc-otp-credential-${otpCredential?index}" class="${properties.kcLoginOTPListInputClass!}" type="radio" name="selectedCredentialId" value="${otpCredential.id}" <#if otpCredential.id == otpLogin.selectedCredentialId>checked="checked"</#if>>
                        <label for="kc-otp-credential-${otpCredential?index}" class="${properties.kcLoginOTPListClass!}" tabindex="${otpCredential?index}">
                            <span class="${properties.kcLoginOTPListItemHeaderClass!}">
                                <span class="${properties.kcLoginOTPListItemIconBodyClass!}">
                                  <i class="${properties.kcLoginOTPListItemIconClass!}" aria-hidden="true"></i>
                                </span>
                                <span class="${properties.kcLoginOTPListItemTitleClass!}">${otpCredential.userLabel}</span>
                            </span>
                        </label>
                    </#list>
                </div>
            </#if>

            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">${msg("loginOtpOneTime")}</label>
                <input id="otp" name="otp" type="text" class="${properties.kcInputClass!} cr-code-input"
                       inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
                       placeholder="000000" autofocus
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"
                       <#if messagesPerField.existsError('totp')>aria-describedby="input-error-otp-code"</#if>/>

                <#if messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}"
                          aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                    <input
                        class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                        name="login" id="kc-login" type="submit" value="${msg("doLogIn")}" />
                </div>
            </div>
        </form>

        <p class="cr-hint">${msg("crOtpLostPhone")}</p>
    </#if>
</@layout.registrationLayout>
