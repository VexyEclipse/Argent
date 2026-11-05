package com.vexyeclipse.argent;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Installs a newer Argent APK from the project's GitHub releases (the page finds it,
 * src/platform/androidUpdate.ts). Downloads it, then hands it to Android's own
 * installer, which always asks the viewer to confirm. Progress goes to the page as
 * "update" events.
 */
final class Updater {
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static volatile boolean busy;

    private Updater() {}

    private static void event(String state, Integer percent, String message) {
        try {
            JSONObject e = new JSONObject().put("type", "update").put("state", state);
            if (percent != null) e.put("percent", percent);
            if (message != null) e.put("message", message);
            MainActivity.sendEvent(e);
        } catch (JSONException ignored) {
            // nothing to report
        }
    }

    static void install(Activity activity, String url, String version) {
        if (busy) return;
        if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) {
            event("error", null, "Updates only come from Argent's GitHub releases");
            return;
        }
        // Android 8+ asks once whether Argent may install apps.
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            event("permission", null, null);
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        busy = true;
        Context app = activity.getApplicationContext();
        worker.execute(() -> {
            try {
                File apk = download(app, url, version);
                event("installing", null, null);
                commit(app, apk);
            } catch (IOException | RuntimeException e) {
                event("error", null, e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                busy = false;
            }
        });
    }

    private static File download(Context context, String url, String version) throws IOException {
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No room to download the update");
        File done = new File(dir, "Argent-" + version.replaceAll("[^0-9A-Za-z.-]", "") + ".apk");
        if (done.isFile() && done.length() > 0) return done;
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();

        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(20_000);
        c.setReadTimeout(60_000);
        c.setRequestProperty("User-Agent", "Argent-Android");
        if (c.getResponseCode() != 200) throw new IOException("Download failed (" + c.getResponseCode() + ")");
        long total = c.getContentLengthLong();
        File part = new File(dir, done.getName() + ".part");
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[64 * 1024];
            long read = 0;
            int lastPercent = -1;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                read += n;
                int percent = total > 0 ? (int) (read * 100 / total) : 0;
                if (percent != lastPercent && percent % 2 == 0) {
                    lastPercent = percent;
                    event("downloading", percent, null);
                }
            }
        } finally {
            c.disconnect();
        }
        if (!part.renameTo(done)) throw new IOException("Couldn't save the update");
        return done;
    }

    private static void commit(Context context, File apk) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        params.setSize(apk.length());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("argent.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(context, InstallResult.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(context, id, status, flags).getIntentSender());
        }
    }

    /** Android's answer: show its confirmation screen, or report how it went. */
    public static final class InstallResult extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            switch (status) {
                case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                    @SuppressWarnings("deprecation")
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(confirm);
                    }
                    break;
                }
                case PackageInstaller.STATUS_SUCCESS:
                    // The new version replaces this process; nothing more to say.
                    break;
                case PackageInstaller.STATUS_FAILURE_ABORTED:
                    event("cancelled", null, null);
                    break;
                default:
                    event("error", null, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                    break;
            }
        }
    }
}
