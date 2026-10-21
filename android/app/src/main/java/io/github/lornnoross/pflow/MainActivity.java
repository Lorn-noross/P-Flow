package io.github.lornnoross.pflow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Module natif de P-Flow (Drive, Enregistrer sous, mises à jour) : à déclarer avant super.onCreate.
        registerPlugin(PFlowNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
