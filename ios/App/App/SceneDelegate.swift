import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else {
            return
        }

        let bridgeViewController = BridgeViewController()

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = bridgeViewController

        window?.backgroundColor = UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(
                    red: 0,
                    green: 0,
                    blue: 0,
                    alpha: 1
                )
                : UIColor(
                    red: 0.937,
                    green: 0.941,
                    blue: 0.961,
                    alpha: 1
                )
        }

        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(
            scene,
            willConnectTo: session,
            options: connectionOptions
        )
    }

    func scene(
        _ scene: UIScene,
        openURLContexts URLContexts: Set<UIOpenURLContext>
    ) {
        SceneDelegateProxy.shared.scene(
            scene,
            openURLContexts: URLContexts
        )
    }

    func scene(
        _ scene: UIScene,
        continue userActivity: NSUserActivity
    ) {
        SceneDelegateProxy.shared.scene(
            scene,
            continue: userActivity
        )
    }
}