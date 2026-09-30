import UIKit
import Capacitor

final class BridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        // These local native plugins are not npm packages, so register them
        // explicitly with the bridge.
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(CapExternalOpener())
    }
}
