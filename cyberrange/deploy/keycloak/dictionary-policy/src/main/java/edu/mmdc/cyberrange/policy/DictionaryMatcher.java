package edu.mmdc.cyberrange.policy;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Immutable, local matcher. Candidate passwords are never retained or logged. */
final class DictionaryMatcher {
    static final int MAX_PASSWORD_LENGTH = 128;
    static final String DICTIONARY_SHA256 = "981da5c06d01da21cdf6f37def0661ffb028266d21ce8f572510a5022e0a238d";
    private final Set<String> words;
    private final int maxWordLength;

    private DictionaryMatcher(Set<String> words) {
        this.words = Set.copyOf(words);
        this.maxWordLength = words.stream().mapToInt(String::length).max().orElseThrow();
    }

    static DictionaryMatcher loadPinned(InputStream stream) {
        if (stream == null) throw new IllegalStateException("Dictionary resource missing");
        try (stream) {
            byte[] data = stream.readNBytes(1_000_001);
            String checksum = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
            if (data.length > 1_000_000 || !DICTIONARY_SHA256.equals(checksum)) {
                throw new IllegalStateException("Dictionary resource checksum mismatch");
            }
            return load(new java.io.ByteArrayInputStream(data));
        } catch (IOException | NoSuchAlgorithmException ex) {
            throw new IllegalStateException("Cannot verify dictionary resource", ex);
        }
    }

    static DictionaryMatcher load(InputStream stream) {
        if (stream == null) throw new IllegalStateException("Dictionary resource missing");
        Set<String> words = new HashSet<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.matches("[a-z]{1,128}") || !words.add(line)) {
                    throw new IllegalStateException("Invalid dictionary resource");
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("Cannot read dictionary resource", ex);
        }
        if (words.isEmpty()) throw new IllegalStateException("Dictionary resource empty");
        return new DictionaryMatcher(words);
    }

    boolean rejects(String password) {
        // Bound work before Unicode normalization, including requests bypassing length policy.
        if (password == null || password.length() > MAX_PASSWORD_LENGTH) return true;
        String normalized = Normalizer.normalize(password, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        if (normalized.length() > MAX_PASSWORD_LENGTH) return true;
        for (int start = 0; start < normalized.length(); start++) {
            int endLimit = Math.min(normalized.length(), start + maxWordLength);
            for (int end = start + 1; end <= endLimit; end++) {
                if (words.contains(normalized.substring(start, end))) return true;
                // Dictionary contains ASCII letters only; no word crosses a separator.
                char next = normalized.charAt(end - 1);
                if (next < 'a' || next > 'z') break;
            }
        }
        return false;
    }
}
