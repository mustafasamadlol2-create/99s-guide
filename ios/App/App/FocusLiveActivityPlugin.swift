import ActivityKit
import Capacitor
import Foundation

@objc(FocusLiveActivity)
public final class FocusLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusLiveActivity"
    public let jsName = "FocusLiveActivity"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
    ]

    @objc public func getAvailability(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false, "enabled": false])
            return
        }
        let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        call.resolve(["supported": true, "enabled": enabled])
    }

    @objc public func sync(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false, "enabled": false, "action": "unsupported"])
            return
        }

        guard let payload = FocusLiveActivityPayload(call: call) else {
            call.reject("INVALID_PAYLOAD", "Invalid Focus Live Activity payload.")
            return
        }

        Task {
            do {
                let result = try await FocusLiveActivityCoordinator.shared.sync(payload)
                await MainActor.run { call.resolve(result) }
            } catch {
                await MainActor.run {
                    call.reject("LIVE_ACTIVITY_SYNC_FAILED", "Focus Live Activity could not be synchronized.", error)
                }
            }
        }
    }

    @objc public func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false, "ended": 0])
            return
        }
        let rawSessionId = call.getString("sessionId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let sessionId = rawSessionId?.isEmpty == false ? rawSessionId : nil
        Task {
            let count = await FocusLiveActivityCoordinator.shared.end(sessionId: sessionId)
            await MainActor.run { call.resolve(["supported": true, "ended": count]) }
        }
    }

    @objc public func endAll(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false, "ended": 0])
            return
        }
        Task {
            let count = await FocusLiveActivityCoordinator.shared.end(sessionId: nil)
            await MainActor.run { call.resolve(["supported": true, "ended": count]) }
        }
    }
}

@available(iOS 16.1, *)
private struct FocusLiveActivityPayload: Sendable {
    let sessionId: String
    let lectureTitle: String
    let phase: String
    let remainingSeconds: Int
    let endAt: Date?
    let sessionNumber: Int
    let plannedSessionCount: Int
    let locale: String

    init?(call: CAPPluginCall) {
        guard
            let rawSessionId = call.getString("sessionId")?.trimmingCharacters(in: .whitespacesAndNewlines),
            !rawSessionId.isEmpty,
            rawSessionId.count <= 128
        else { return nil }

        let acceptedPhases = Set(["FOCUSING", "PAUSED", "BREAK", "BREAK_PAUSED"])
        guard
            let rawPhase = call.getString("phase")?.uppercased(),
            acceptedPhases.contains(rawPhase)
        else { return nil }

        let rawTitle = call.getString("lectureTitle")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = rawTitle.isEmpty ? "Focus Session" : String(rawTitle.prefix(160))
        let seconds = max(0, min(call.getInt("remainingSeconds") ?? 0, 24 * 60 * 60))
        let sessionNumber = max(1, min(call.getInt("sessionNumber") ?? 1, 999))
        let plannedSessionCount = max(sessionNumber, min(call.getInt("plannedSessionCount") ?? sessionNumber, 999))
        let locale = call.getString("locale")?.lowercased() == "ar" ? "ar" : "en"

        var parsedEndAt: Date? = nil
        if let rawEndAt = call.getString("endAt"), !rawEndAt.isEmpty {
            parsedEndAt = ISO8601DateFormatter.focusLiveActivityFractional.date(from: rawEndAt)
                ?? ISO8601DateFormatter.focusLiveActivityWholeSeconds.date(from: rawEndAt)
            if parsedEndAt == nil { return nil }
        }

        self.sessionId = rawSessionId
        self.lectureTitle = title
        self.phase = rawPhase
        self.remainingSeconds = seconds
        self.endAt = parsedEndAt
        self.sessionNumber = sessionNumber
        self.plannedSessionCount = plannedSessionCount
        self.locale = locale
    }
}

private extension ISO8601DateFormatter {
    static let focusLiveActivityFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let focusLiveActivityWholeSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

@available(iOS 16.1, *)
private actor FocusLiveActivityCoordinator {
    static let shared = FocusLiveActivityCoordinator()

    func sync(_ payload: FocusLiveActivityPayload) async throws -> JSObject {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            await endOtherSessions(keeping: nil)
            return ["supported": true, "enabled": false, "action": "disabled"]
        }

        let contentState = FocusActivityAttributes.ContentState(
            lectureTitle: payload.lectureTitle,
            phase: payload.phase,
            remainingSeconds: payload.remainingSeconds,
            endAt: payload.endAt,
            updatedAt: Date(),
            sessionNumber: payload.sessionNumber,
            plannedSessionCount: payload.plannedSessionCount,
            locale: payload.locale
        )

        await endOtherSessions(keeping: payload.sessionId)

        if let existing = Activity<FocusActivityAttributes>.activities.first(where: {
            $0.attributes.sessionId == payload.sessionId
        }) {
            await update(existing, state: contentState)
            return [
                "supported": true,
                "enabled": true,
                "action": "updated",
                "activityId": existing.id,
            ]
        }

        let attributes = FocusActivityAttributes(sessionId: payload.sessionId)
        let activity: Activity<FocusActivityAttributes>
        if #available(iOS 16.2, *) {
            let content = ActivityContent(
                state: contentState,
                staleDate: staleDate(for: contentState)
            )
            activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
        } else {
            activity = try Activity.request(
                attributes: attributes,
                contentState: contentState,
                pushType: nil
            )
        }

        return [
            "supported": true,
            "enabled": true,
            "action": "created",
            "activityId": activity.id,
        ]
    }

    func end(sessionId: String?) async -> Int {
        let activities = Activity<FocusActivityAttributes>.activities.filter { activity in
            guard let sessionId else { return true }
            return activity.attributes.sessionId == sessionId
        }
        for activity in activities {
            await finish(activity)
        }
        return activities.count
    }

    private func endOtherSessions(keeping sessionId: String?) async {
        let stale = Activity<FocusActivityAttributes>.activities.filter { activity in
            guard let sessionId else { return true }
            return activity.attributes.sessionId != sessionId
        }
        for activity in stale {
            await finish(activity)
        }
    }

    private func update(
        _ activity: Activity<FocusActivityAttributes>,
        state: FocusActivityAttributes.ContentState
    ) async {
        if #available(iOS 16.2, *) {
            await activity.update(ActivityContent(
                state: state,
                staleDate: staleDate(for: state)
            ))
        } else {
            await activity.update(using: state)
        }
    }

    private func finish(_ activity: Activity<FocusActivityAttributes>) async {
        if #available(iOS 16.2, *) {
            let finalState = activity.content.state
            await activity.end(
                ActivityContent(state: finalState, staleDate: nil),
                dismissalPolicy: .immediate
            )
        } else {
            await activity.end(using: activity.contentState, dismissalPolicy: .immediate)
        }
    }

    private func staleDate(for state: FocusActivityAttributes.ContentState) -> Date? {
        guard let endAt = state.endAt else { return nil }
        return endAt.addingTimeInterval(5 * 60)
    }
}
