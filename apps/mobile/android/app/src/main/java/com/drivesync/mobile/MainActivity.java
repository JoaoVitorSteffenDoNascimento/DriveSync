package com.drivesync.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DriveSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
