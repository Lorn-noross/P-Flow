package io.github.lornnoross.pflow;

import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Hauteur de la barre d'état en px CSS, transmise à la page (variable CSS --sat). -1 tant qu'elle n'est pas connue. */
    static volatile int topInsetCss = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Module natif de P-Flow (Drive, Enregistrer sous, mises à jour) : à déclarer avant super.onCreate.
        registerPlugin(PFlowNativePlugin.class);
        super.onCreate(savedInstanceState);
        immersiveTop();
    }

    /*
     * Android 15+ (affichage bord à bord imposé) : la page passe sous la barre d'état, pour que le fond de l'appli
     * monte jusqu'en haut de l'écran. Les marges restent à gauche, à droite et en bas (barre de navigation), comme
     * avec le réglage Capacitor « adjustMarginsForEdgeToEdge: auto », dont ce gestionnaire prend la place.
     * Le WebView ne donne pas toujours env(safe-area-inset-top) (bug des versions < 140) : la hauteur de la barre
     * d'état arrive donc dans la variable CSS --sat. Avant Android 15, rien ne change (barre d'état colorée).
     */
    private void immersiveTop() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        Bridge b = getBridge();
        if (b == null || b.getWebView() == null) return; // sans WebView, Capacitor garde ses propres marges
        final WebView wv = b.getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(wv, (v, wi) -> {
            Insets in = wi.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            if (mlp.topMargin != 0 || mlp.leftMargin != in.left || mlp.rightMargin != in.right || mlp.bottomMargin != in.bottom) {
                mlp.topMargin = 0;
                mlp.leftMargin = in.left;
                mlp.rightMargin = in.right;
                mlp.bottomMargin = in.bottom;
                v.setLayoutParams(mlp);
            }
            int css = Math.round(in.top / v.getResources().getDisplayMetrics().density);
            if (css != topInsetCss) {
                topInsetCss = css;
                // Page déjà chargée : mise à jour immédiate. Sinon, la page la demande au démarrage (setSystemBars).
                wv.evaluateJavascript("document.documentElement.style.setProperty('--sat','" + css + "px')", null);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(wv);
    }
}
