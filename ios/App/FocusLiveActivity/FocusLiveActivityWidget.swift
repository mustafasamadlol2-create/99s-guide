import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
struct FocusLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusLockScreenView(context: context)
                .activityBackgroundTint(Color(red: 0.025, green: 0.075, blue: 0.18))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    FocusFlameMark()
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusTimerText(state: context.state, compact: false)
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.lectureTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        FocusStatusPill(state: context.state)
                        Spacer(minLength: 8)
                        Text(roundLabel(context.state))
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            } compactLeading: {
                Image(systemName: "flame.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.orange)
                    .accessibilityLabel(statusLabel(context.state))
            } compactTrailing: {
                FocusTimerText(state: context.state, compact: true)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: "flame.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.orange)
                    .accessibilityLabel(statusLabel(context.state))
            }
            .keylineTint(Color.orange)
        }
    }
}

@available(iOS 16.1, *)
private struct FocusLockScreenView: View {
    let context: ActivityViewContext<FocusActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            FocusFlameMark()

            VStack(alignment: .leading, spacing: 5) {
                Text(context.state.lectureTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                HStack(spacing: 7) {
                    FocusStatusPill(state: context.state)
                    Text(roundLabel(context.state))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                }
            }

            Spacer(minLength: 8)

            FocusTimerText(state: context.state, compact: false)
                .font(.system(size: 29, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(context.state.lectureTitle), \(statusLabel(context.state))")
    }
}

@available(iOS 16.1, *)
private struct FocusFlameMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.09))
                .frame(width: 38, height: 38)
            Image(systemName: "flame.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.orange)
        }
        .accessibilityHidden(true)
    }
}

@available(iOS 16.1, *)
private struct FocusStatusPill: View {
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(statusColor(state))
                .frame(width: 6, height: 6)
            Text(statusLabel(state))
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))
        }
    }
}

@available(iOS 16.1, *)
private struct FocusTimerText: View {
    let state: FocusActivityAttributes.ContentState
    let compact: Bool

    var body: some View {
        Group {
            if isRunning(state), let endAt = state.endAt, endAt > Date() {
                Text(timerInterval: Date()...endAt, countsDown: true, showsHours: state.remainingSeconds >= 3_600)
            } else {
                Text(formatDuration(state.remainingSeconds, compact: compact))
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .foregroundStyle(.white)
        .accessibilityLabel(timeAccessibilityLabel(state.remainingSeconds, locale: state.locale))
    }
}

@available(iOS 16.1, *)
private func isRunning(_ state: FocusActivityAttributes.ContentState) -> Bool {
    state.phase == "FOCUSING" || state.phase == "BREAK"
}

@available(iOS 16.1, *)
private func statusColor(_ state: FocusActivityAttributes.ContentState) -> Color {
    switch state.phase {
    case "BREAK", "BREAK_PAUSED":
        return .mint
    case "PAUSED":
        return .yellow
    default:
        return .orange
    }
}

@available(iOS 16.1, *)
private func statusLabel(_ state: FocusActivityAttributes.ContentState) -> String {
    let arabic = state.locale == "ar"
    switch state.phase {
    case "BREAK":
        return arabic ? "استراحة" : "Break"
    case "BREAK_PAUSED":
        return arabic ? "الاستراحة متوقفة" : "Break paused"
    case "PAUSED":
        return arabic ? "متوقف" : "Paused"
    default:
        return arabic ? "تركيز" : "Focusing"
    }
}

@available(iOS 16.1, *)
private func roundLabel(_ state: FocusActivityAttributes.ContentState) -> String {
    if state.locale == "ar" {
        return "الجلسة \(state.sessionNumber)/\(state.plannedSessionCount)"
    }
    return "Session \(state.sessionNumber)/\(state.plannedSessionCount)"
}

@available(iOS 16.1, *)
private func formatDuration(_ seconds: Int, compact: Bool) -> String {
    let safe = max(0, seconds)
    let hours = safe / 3_600
    let minutes = (safe % 3_600) / 60
    let remaining = safe % 60
    if hours > 0 && !compact {
        return String(format: "%d:%02d:%02d", hours, minutes, remaining)
    }
    let totalMinutes = safe / 60
    return String(format: "%02d:%02d", totalMinutes, remaining)
}

@available(iOS 16.1, *)
private func timeAccessibilityLabel(_ seconds: Int, locale: String) -> String {
    let safe = max(0, seconds)
    let minutes = safe / 60
    let remaining = safe % 60
    if locale == "ar" {
        return "\(minutes) دقيقة و \(remaining) ثانية متبقية"
    }
    return "\(minutes) minutes and \(remaining) seconds remaining"
}
