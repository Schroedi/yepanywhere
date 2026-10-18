package com.yepanywhere.host;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** A saved credential or status file is not evidence of a live local server. */
final class HostConnection {
    static final String ORIGIN = "http://127.0.0.1:13400";
    private HostConnection() { }

    // Call only off the main thread. Return the current credential only after
    // the server accepts it. This endpoint is a cheap fixed disabled response
    // under the Android profile; it never samples workstation processes.
    static String ready(File home) {
        HttpURLConnection connection = null;
        try {
            String status = new String(Files.readAllBytes(new File(home.getParentFile(), "host-status.txt").toPath()), StandardCharsets.UTF_8);
            // Stop/start can overlap while the previous process group drains.
            // Do not mistake that still-responsive old server for a new start.
            if (!status.startsWith("Host process started")) return null;
            String token = new String(Files.readAllBytes(new File(home, ".local-access-token").toPath()), StandardCharsets.UTF_8).trim();
            if (!token.matches("[A-Za-z0-9_-]{43}")) return null;
            connection = (HttpURLConnection) new URL(ORIGIN + "/api/host-agent-processes").openConnection();
            connection.setConnectTimeout(1000);
            connection.setReadTimeout(1000);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("X-Desktop-Token", token);
            return connection.getResponseCode() == 200 ? token : null;
        } catch (Exception unavailable) { return null; }
        finally { if (connection != null) connection.disconnect(); }
    }
}
