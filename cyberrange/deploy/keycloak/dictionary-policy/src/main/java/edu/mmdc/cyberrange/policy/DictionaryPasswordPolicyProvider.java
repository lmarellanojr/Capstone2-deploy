package edu.mmdc.cyberrange.policy;

import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.policy.PasswordPolicyConfigException;
import org.keycloak.policy.PasswordPolicyProvider;
import org.keycloak.policy.PolicyError;

public final class DictionaryPasswordPolicyProvider implements PasswordPolicyProvider {
    public static final String CONFIG = "scowl-en-v1";
    public static final String ERROR = "invalidPasswordDictionaryWordMessage";
    private final DictionaryMatcher matcher;

    DictionaryPasswordPolicyProvider(DictionaryMatcher matcher) { this.matcher = matcher; }

    @Override public PolicyError validate(RealmModel realm, UserModel user, String password) {
        return validate((String) null, password);
    }
    @Override public PolicyError validate(String username, String password) {
        return matcher.rejects(password) ? new PolicyError(ERROR) : null;
    }
    @Override public Object parseConfig(String value) {
        if (!CONFIG.equals(value)) throw new PasswordPolicyConfigException("Dictionary policy requires " + CONFIG);
        return CONFIG;
    }
    @Override public void close() { }
}
