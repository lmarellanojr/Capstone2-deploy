<#--
  Authenticator setup (CONFIGURE_TOTP). Based on Keycloak 25.0.6
  base/login/login-config-totp.ftl: same form id/action and field names
  (totp, userLabel, totpSecret, mode, logout-sessions, cancel-aia), same QR /
  manual-key modes and error handling. New: an intro, numbered step cards,
  a centred QR code and a numeric one-time-code input.
-->
<#import "template.ftl" as layout>
<#import "password-commons.ftl" as passwordCommons>
<#-- Keycloak's own "You need to set up Mobile Authenticator" warning repeats the intro below, so it is
     not shown here; errors (e.g. a wrong code) still are. -->
<@layout.registrationLayout displayRequiredFields=false displayMessage=(!messagesPerField.existsError('totp','userLabel') && !(message?has_content && message.type == 'warning')) bodyClass="cr-wide"; section>

    <#if section = "header">
        ${msg("loginTotpTitle")}
    <#elseif section = "form">
        <p class="cr-intro">${msg("crTotpIntro")}</p>

        <ol id="kc-totp-settings" class="cr-steps">
            <li class="cr-step">
                <span class="cr-step__num" aria-hidden="true">1</span>
                <div class="cr-step__body">
                    <p>${msg("loginTotpStep1")}</p>
                    <ul id="kc-totp-supported-apps" class="cr-apps">
                        <#list totp.supportedApplications as app>
                            <li>${msg(app)}</li>
                        </#list>
                    </ul>
                </div>
            </li>

            <#if mode?? && mode = "manual">
                <li class="cr-step">
                    <span class="cr-step__num" aria-hidden="true">2</span>
                    <div class="cr-step__body">
                        <p>${msg("loginTotpManualStep2")}</p>
                        <p class="cr-secret"><span id="kc-totp-secret-key">${totp.totpSecretEncoded}</span></p>
                        <p>${msg("loginTotpManualStep3")}</p>
                        <ul class="cr-policy">
                            <li id="kc-totp-type">${msg("loginTotpType")}: ${msg("loginTotp." + totp.policy.type)}</li>
                            <li id="kc-totp-algorithm">${msg("loginTotpAlgorithm")}: ${totp.policy.getAlgorithmKey()}</li>
                            <li id="kc-totp-digits">${msg("loginTotpDigits")}: ${totp.policy.digits}</li>
                            <#if totp.policy.type = "totp">
                                <li id="kc-totp-period">${msg("loginTotpInterval")}: ${totp.policy.period}</li>
                            <#elseif totp.policy.type = "hotp">
                                <li id="kc-totp-counter">${msg("loginTotpCounter")}: ${totp.policy.initialCounter}</li>
                            </#if>
                        </ul>
                        <p><a href="${totp.qrUrl}" id="mode-barcode">${msg("loginTotpScanBarcode")}</a></p>
                    </div>
                </li>
            <#else>
                <li class="cr-step">
                    <span class="cr-step__num" aria-hidden="true">2</span>
                    <div class="cr-step__body">
                        <p>${msg("loginTotpStep2")}</p>
                        <div class="cr-qr">
                            <img id="kc-totp-secret-qr-code" src="data:image/png;base64, ${totp.totpSecretQrCode}" alt="QR code to scan with your authenticator app" width="180" height="180">
                        </div>
                        <p class="cr-qr__alt"><a href="${totp.manualUrl}" id="mode-manual">${msg("loginTotpUnableToScan")}</a></p>
                    </div>
                </li>
            </#if>

            <li class="cr-step">
                <span class="cr-step__num" aria-hidden="true">3</span>
                <div class="cr-step__body">
                    <p>${msg("loginTotpStep3")}</p>
                    <p class="cr-muted">${msg("loginTotpStep3DeviceName")}</p>
                </div>
            </li>
        </ol>

        <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-totp-settings-form" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="totp" class="${properties.kcLabelClass!}">${msg("authenticatorCode")} <span class="required">*</span></label>
                <input type="text" id="totp" name="totp" class="${properties.kcInputClass!} cr-code-input"
                       inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000"
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"
                       <#if messagesPerField.existsError('totp')>aria-describedby="input-error-otp-code"</#if>
                />
                <#if messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
                <input type="hidden" id="totpSecret" name="totpSecret" value="${totp.totpSecret}" />
                <#if mode??><input type="hidden" id="mode" name="mode" value="${mode}"/></#if>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <label for="userLabel" class="${properties.kcLabelClass!}">${msg("loginTotpDeviceName")} <#if totp.otpCredentials?size gte 1><span class="required">*</span></#if></label>
                <input type="text" class="${properties.kcInputClass!}" id="userLabel" name="userLabel" autocomplete="off"
                       placeholder="${msg("crTotpDeviceNamePlaceholder")}"
                       aria-invalid="<#if messagesPerField.existsError('userLabel')>true</#if>"
                       <#if messagesPerField.existsError('userLabel')>aria-describedby="input-error-otp-label"</#if>
                />
                <#if messagesPerField.existsError('userLabel')>
                    <span id="input-error-otp-label" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('userLabel'))?no_esc}
                    </span>
                </#if>
            </div>

            <div class="${properties.kcFormGroupClass!} cr-logout-others">
                <@passwordCommons.logoutOtherSessions/>
            </div>

            <#if isAppInitiatedAction??>
                <div class="cr-actions">
                    <input type="submit"
                           class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonLargeClass!}"
                           id="saveTOTPBtn" value="${msg("crTotpSubmit")}"
                    />
                    <button type="submit"
                            class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonLargeClass!}"
                            id="cancelTOTPBtn" name="cancel-aia" value="true">${msg("doCancel")}</button>
                </div>
            <#else>
                <input type="submit"
                       class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                       id="saveTOTPBtn" value="${msg("crTotpSubmit")}"
                />
            </#if>
        </form>
    </#if>
</@layout.registrationLayout>
