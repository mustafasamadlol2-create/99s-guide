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
        case midnight = "midnight"
        case rose = "rose"
        case monochrome = "monochrome"
        case navyOutline = "navy-outline"
        case navy = "navy"
        case ocean = "ocean"
        case redOutline = "red-outline"
        case red = "red"
        case crimson = "crimson"
        case blackOutline = "black-outline"
        case black = "black"
        case gold = "gold"
        case skyOutline = "sky-outline"
        case sky = "sky"
        case azure = "azure"
        case lime = "lime"
        case pink = "pink"
        case orange = "orange"
        case limeInk = "lime-ink"
        case lemonInk = "lemon-ink"
        case teal = "teal"
        case charcoalLemon = "charcoal-lemon"
        case charcoalLime = "charcoal-lime"
        case charcoalCyan = "charcoal-cyan"
        case orangeInk = "orange-ink"
        case silver = "silver"
        case graphite = "graphite"
        case pearl = "pearl"
        case violet = "violet"
        case bronze = "bronze"
        case lilac = "lilac"

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
            case .navyOutline:
                return "AppIconNavyOutline"
            case .navy:
                return "AppIconNavy"
            case .ocean:
                return "AppIconOcean"
            case .redOutline:
                return "AppIconRedOutline"
            case .red:
                return "AppIconRed"
            case .crimson:
                return "AppIconCrimson"
            case .blackOutline:
                return "AppIconBlackOutline"
            case .black:
                return "AppIconBlack"
            case .gold:
                return "AppIconGold"
            case .skyOutline:
                return "AppIconSkyOutline"
            case .sky:
                return "AppIconSky"
            case .azure:
                return "AppIconAzure"
            case .lime:
                return "AppIconLime"
            case .pink:
                return "AppIconPink"
            case .orange:
                return "AppIconOrange"
            case .limeInk:
                return "AppIconLimeInk"
            case .lemonInk:
                return "AppIconLemonInk"
            case .teal:
                return "AppIconTeal"
            case .charcoalLemon:
                return "AppIconCharcoalLemon"
            case .charcoalLime:
                return "AppIconCharcoalLime"
            case .charcoalCyan:
                return "AppIconCharcoalCyan"
            case .orangeInk:
                return "AppIconOrangeInk"
            case .silver:
                return "AppIconSilver"
            case .graphite:
                return "AppIconGraphite"
            case .pearl:
                return "AppIconPearl"
            case .violet:
                return "AppIconViolet"
            case .bronze:
                return "AppIconBronze"
            case .lilac:
                return "AppIconLilac"
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