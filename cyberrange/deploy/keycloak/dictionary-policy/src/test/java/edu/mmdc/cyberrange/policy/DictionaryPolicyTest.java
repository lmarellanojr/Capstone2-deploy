package edu.mmdc.cyberrange.policy;

import static org.junit.jupiter.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.keycloak.policy.PasswordPolicyConfigException;
import org.keycloak.policy.PasswordPolicyProvider;

class DictionaryPolicyTest {
    private static DictionaryMatcher smallDictionary() {
        return DictionaryMatcher.load(new ByteArrayInputStream("sunshine\nmoon\na\ni\n".getBytes(StandardCharsets.UTF_8)));
    }

    @ParameterizedTest
    @ValueSource(strings={"sunshine", "xxSUNSHINExx!928", "728#moon#837", "moon sunshine", "928#A#728", "928#I#728", "928#ＳＵＮＳＨＩＮＥ#728"})
    void rejectsWordsAtAnyPositionAndLength(String password) {
        assertTrue(smallDictionary().rejects(password));
    }
    @Test void acceptsValuesWithoutDictionaryWordsAndDoesNotJoinSeparatedLetters() {
        var matcher = DictionaryMatcher.load(new ByteArrayInputStream("moon\n".getBytes(StandardCharsets.UTF_8)));
        assertFalse(matcher.rejects("m!o!o!n123"));
        assertFalse(matcher.rejects("728!$938#527+682%394=876*"));
        assertFalse(matcher.rejects("x".repeat(128)));
        assertFalse(matcher.rejects("928#xq#zv#728"));
    }
    @Test void boundsWorkBeforeAndAfterNormalization() {
        var matcher = smallDictionary();
        assertTrue(matcher.rejects(null));
        assertTrue(matcher.rejects(""));
        assertTrue(matcher.rejects("7".repeat(129)));
        assertTrue(matcher.rejects("ﬃ".repeat(44)));
        assertFalse(matcher.rejects("7".repeat(128)));
    }
    @Test void normalizationIsIndependentOfServerLocale() {
        var previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"));
            assertTrue(smallDictionary().rejects("728#I#728"));
        } finally { Locale.setDefault(previous); }
    }
    @Test void missingEmptyInvalidOrUnreadableDataNeverDisablesEnforcement() {
        assertThrows(IllegalStateException.class, () -> DictionaryMatcher.load(null));
        for (String text : new String[]{"", "Moon\n", "moon\nmoon\n", "moon\n\n", "#comment\n"}) {
            assertThrows(IllegalStateException.class, () -> DictionaryMatcher.load(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8))));
        }
        assertThrows(IllegalStateException.class, () -> DictionaryMatcher.load(new InputStream() {
            public int read() throws IOException { throw new IOException("unreadable"); }
        }));
    }
    @Test void bothKeycloakValidationPathsEnforceTheSamePolicyWithoutEchoingPassword() {
        PasswordPolicyProvider provider = new DictionaryPasswordPolicyProvider(smallDictionary());
        String password = "928#SUNSHINE#728";
        assertEquals(DictionaryPasswordPolicyProvider.ERROR, provider.validate("test-user", password).getMessage());
        assertEquals(DictionaryPasswordPolicyProvider.ERROR, provider.validate(null, null, password).getMessage());
        assertNull(provider.validate("test-user", "728!$938#527+682%394=876*"));
        assertNull(provider.validate(null, null, "728!$938#527+682%394=876*"));
    }
    @Test void configurationIsExplicitAndFailsClosed() {
        var provider = new DictionaryPasswordPolicyProvider(smallDictionary());
        assertEquals("scowl-en-v1", provider.parseConfig("scowl-en-v1"));
        for (String config : new String[]{null, "", "undefined", "other-dictionary"}) {
            assertThrows(PasswordPolicyConfigException.class, () -> provider.parseConfig(config));
        }
    }
    @Test void productionFactoryLoadsBundledDictionaryAndKeepsShortWords() {
        var factory = new DictionaryPasswordPolicyProviderFactory();
        assertEquals("dictionaryWords", factory.getId());
        assertEquals("scowl-en-v1", factory.getDefaultConfigValue());
        assertFalse(factory.isMultiplSupported());
        var provider = factory.create(null);
        for (String word : new String[]{"sunshine", "orchid", "river", "copper", "moon", "a", "i", "o"}) {
            assertNotNull(provider.validate("test-user", "928#" + word + "#728"), word);
        }
        assertNull(provider.validate("test-user", "928#xq#zv#728"));
        assertNull(provider.validate("test-user", "728!$938#527+682%394=876*"));
    }
    @Test void truncatedOrAlteredPinnedDictionaryFailsClosed() {
        assertThrows(IllegalStateException.class, () -> DictionaryMatcher.loadPinned(null));
        assertThrows(IllegalStateException.class, () -> DictionaryMatcher.loadPinned(new ByteArrayInputStream("sunshine\n".getBytes(StandardCharsets.UTF_8))));
        assertThrows(IllegalStateException.class, () -> DictionaryMatcher.loadPinned(new ByteArrayInputStream(new byte[1_000_001])));
    }
}
