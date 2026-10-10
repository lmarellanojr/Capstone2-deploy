package edu.mmdc.cyberrange.policy;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.policy.PasswordPolicyProvider;
import org.keycloak.policy.PasswordPolicyProviderFactory;

public final class DictionaryPasswordPolicyProviderFactory implements PasswordPolicyProviderFactory {
    public static final String ID = "dictionaryWords";
    private final DictionaryMatcher matcher = DictionaryMatcher.loadPinned(
            DictionaryPasswordPolicyProviderFactory.class.getResourceAsStream("/dictionary/scowl-en-v1.txt"));

    @Override public String getId() { return ID; }
    @Override public PasswordPolicyProvider create(KeycloakSession session) {
        return new DictionaryPasswordPolicyProvider(matcher);
    }
    @Override public void init(Config.Scope config) { }
    @Override public void postInit(KeycloakSessionFactory factory) { }
    @Override public String getDisplayName() { return "No English Dictionary Words (including substrings)"; }
    @Override public String getConfigType() { return PasswordPolicyProvider.STRING_CONFIG_TYPE; }
    @Override public String getDefaultConfigValue() { return DictionaryPasswordPolicyProvider.CONFIG; }
    @Override public boolean isMultiplSupported() { return false; }
    @Override public void close() { }
}
