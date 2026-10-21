import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct FocusActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var lectureTitle: String
        public var phase: String
        public var remainingSeconds: Int
        public var endAt: Date?
        public var updatedAt: Date
        public var sessionNumber: Int
        public var plannedSessionCount: Int
        public var locale: String

        public init(
            lectureTitle: String,
            phase: String,
            remainingSeconds: Int,
            endAt: Date?,
            updatedAt: Date,
            sessionNumber: Int,
            plannedSessionCount: Int,
            locale: String
        ) {
            self.lectureTitle = lectureTitle
            self.phase = phase
            self.remainingSeconds = remainingSeconds
            self.endAt = endAt
            self.updatedAt = updatedAt
            self.sessionNumber = sessionNumber
            self.plannedSessionCount = plannedSessionCount
            self.locale = locale
        }
    }

    public var sessionId: String

    public init(sessionId: String) {
        self.sessionId = sessionId
    }
}
