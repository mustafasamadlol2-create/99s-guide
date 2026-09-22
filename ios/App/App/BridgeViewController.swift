import UIKit
import Capacitor

final class BridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        // AppIcon is a local native plugin (not an npm package), so register it
        // explicitly with the bridge. This guarantees the selector works in
        // production iPhone/iPad builds instead of silently appearing
        // unsupported when the web layer calls registerPlugin("AppIcon").
        bridge?.registerPluginInstance(AppIconPlugin())
    }
}
