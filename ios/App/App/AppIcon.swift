import UIKit
import Capacitor

@objc(AppIcon)
public final class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIcon"
    public let jsName = "AppIcon"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(
            name: "getState",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(
            name: "setIcon",
            returnType: CAPPluginReturnPromise
        ),
    ]

    private enum ProductIcon: String, CaseIterable {
        case primary
        case midnight
        case rose
        case monochrome

        var nativeName: String? {
            switch self {
            case .primary:
                return nil
            case .midnight:
                return "AppIconMidnight"
            case .rose:
                return "AppIconRose"
            case .monochrome:
                return "AppIconMonochrome"
            }
        }
    }

    @objc public func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let application = UIApplication.shared
            guard application.supportsAlternateIcons else {
                call.resolve([
                    "supported": false,
                    "iconId": ProductIcon.primary.rawValue,
                ])
                return
            }

            guard let nativeName = application.alternateIconName else {
                call.resolve([
                    "supported": true,
                    "iconId": ProductIcon.primary.rawValue,
                ])
                return
            }

            guard
                let productIcon = ProductIcon.allCases.first(where: {
                    $0.nativeName == nativeName
                })
            else {
                NSLog(
                    "[AppIcon] unknown native alternate icon name: %@",
                    nativeName
                )
                call.resolve([
                    "supported": true,
                    "iconId": ProductIcon.primary.rawValue,
                    "nativeState": "unknown",
                ])
                return
            }

            call.resolve([
                "supported": true,
                "iconId": productIcon.rawValue,
            ])
        }
    }

    @objc public func setIcon(_ call: CAPPluginCall) {
        guard let rawIconId = call.getString("iconId") else {
            call.reject("app_icon_invalid_id")
            return
        }

        guard let productIcon = ProductIcon(rawValue: rawIconId) else {
            call.reject("app_icon_invalid_id")
            return
        }

        DispatchQueue.main.async {
            let application = UIApplication.shared
            guard application.supportsAlternateIcons else {
                call.reject("app_icon_unsupported")
                return
            }

            application.setAlternateIconName(productIcon.nativeName) { error in
                DispatchQueue.main.async {
                    if let error {
                        call.reject(
                            "app_icon_change_failed",
                            "The native App Icon change failed.",
                            error
                        )
                        return
                    }

                    call.resolve([
                        "iconId": productIcon.rawValue,
                    ])
                }
            }
        }
    }
}