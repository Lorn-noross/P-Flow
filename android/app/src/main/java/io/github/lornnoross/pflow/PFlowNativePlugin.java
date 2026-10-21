package io.github.lornnoross.pflow;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;

/**
 * Fonctions natives de P-Flow (Android) :
 * - autorisation Google Drive limitée aux fichiers créés par P-Flow (drive.file) ;
 * - « Enregistrer sous » pour l'export des données ;
 * - téléchargement et installation des mises à jour, uniquement depuis les versions publiées de P-Flow.
 */
@CapacitorPlugin(name = "PFlowNative")
public class PFlowNativePlugin extends Plugin {

    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    private static final String RELEASES = "https://github.com/lorn-noross/p-flow/releases/download/";
    private static final String APK_DIR = "maj";
    private static final String APK_NAME = "P-Flow.apk";

    private ActivityResultLauncher<IntentSenderRequest> authLauncher;
    private PluginCall pendingAuth;
    private String pendingSaveData;

    @Override
    public void load() {
        // Doit être enregistré pendant la création de l'activité (c'est le cas de load()).
        authLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = pendingAuth;
            pendingAuth = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("Autorisation Google Drive annulée.", "CANCELED");
                return;
            }
            try {
                AuthorizationResult ar = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                resolveToken(call, ar);
            } catch (ApiException e) {
                call.reject("Autorisation Google Drive refusée.", "AUTH_ERROR", e);
            }
        });
    }

    /* ---------- Google Drive ---------- */

    @PluginMethod
    public void authorizeDrive(PluginCall call) {
        final boolean interactive = call.getBoolean("interactive", false);
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_SCOPE)))
            .build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(ar -> {
                if (!ar.hasResolution()) {
                    // Accès déjà accordé : jeton sans rien afficher.
                    resolveToken(call, ar);
                    return;
                }
                if (!interactive || ar.getPendingIntent() == null) {
                    call.reject("Il faut autoriser l'accès à Google Drive.", "NEEDS_CONSENT");
                    return;
                }
                if (pendingAuth != null) pendingAuth.reject("Autorisation remplacée.", "CANCELED");
                pendingAuth = call;
                authLauncher.launch(new IntentSenderRequest.Builder(ar.getPendingIntent().getIntentSender()).build());
            })
            .addOnFailureListener(e -> call.reject("Google Drive est indisponible pour le moment.", "AUTH_ERROR", e));
    }

    private void resolveToken(PluginCall call, AuthorizationResult ar) {
        String token = ar.getAccessToken();
        if (token == null) {
            call.reject("L'accès à Google Drive n'a pas été accordé.", "NO_TOKEN");
            return;
        }
        JSObject r = new JSObject();
        r.put("accessToken", token);
        call.resolve(r);
    }

    /* ---------- Enregistrer sous (export des données) ---------- */

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "p-flow.json");
        String data = call.getString("data");
        if (data == null) {
            call.reject("Rien à enregistrer.", "NO_DATA");
            return;
        }
        pendingSaveData = data;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        String data = pendingSaveData;
        pendingSaveData = null;
        if (call == null) return;
        Intent res = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || res == null || res.getData() == null || data == null) {
            call.reject("Enregistrement annulé.", "CANCELED");
            return;
        }
        try (OutputStream os = getContext().getContentResolver().openOutputStream(res.getData(), "wt")) {
            if (os == null) throw new IllegalStateException("Fichier inaccessible");
            os.write(data.getBytes(StandardCharsets.UTF_8));
            JSObject r = new JSObject();
            r.put("saved", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Le fichier n'a pas pu être enregistré.", "WRITE_ERROR", e);
        }
    }

    /* ---------- Mises à jour ---------- */

    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.toLowerCase(Locale.ROOT).startsWith(RELEASES) || !url.toLowerCase(Locale.ROOT).endsWith(".apk")) {
            call.reject("Adresse de mise à jour refusée.", "BAD_URL");
            return;
        }
        new Thread(() -> {
            HttpURLConnection c = null;
            File dir = new File(getContext().getCacheDir(), APK_DIR);
            File part = new File(dir, APK_NAME + ".part");
            File out = new File(dir, APK_NAME);
            try {
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Dossier inaccessible");
                // Les redirections de GitHub restent en https : suivies automatiquement.
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) throw new IllegalStateException("HTTP " + code);
                long total = c.getContentLengthLong();
                long done = 0;
                int lastPct = -1;
                try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream os = new FileOutputStream(part)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        os.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject p = new JSObject();
                                p.put("percent", pct);
                                notifyListeners("downloadProgress", p);
                            }
                        }
                    }
                }
                if (total > 0 && done != total) throw new IllegalStateException("Téléchargement incomplet");
                if (out.exists() && !out.delete()) throw new IllegalStateException("Ancien fichier bloqué");
                if (!part.renameTo(out)) throw new IllegalStateException("Fichier inaccessible");
                JSObject r = new JSObject();
                r.put("size", done);
                call.resolve(r);
            } catch (Exception e) {
                part.delete();
                call.reject("La mise à jour n'a pas pu être téléchargée.", "DOWNLOAD_ERROR", e);
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        File f = new File(new File(getContext().getCacheDir(), APK_DIR), APK_NAME);
        if (!f.exists()) {
            call.reject("La mise à jour n'est pas encore téléchargée.", "NO_FILE");
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(f.getAbsolutePath(), 0);
        if (info == null || !getContext().getPackageName().equals(info.packageName)) {
            f.delete();
            call.reject("Le fichier téléchargé n'est pas une version de P-Flow.", "BAD_APK");
            return;
        }
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
            // Première fois : Android demande d'autoriser P-Flow à installer des applis.
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            r.put("needsPermission", true);
            call.resolve(r);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        r.put("needsPermission", false);
        call.resolve(r);
    }
}
