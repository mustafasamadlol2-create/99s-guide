/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string; // url or descriptor
  totalPoints: number;
  level: string; // e.g. "Rising (Resident)"
  streakDays: number;
  levelBadge: string; // emoji
  created_at: string;
  isAdmin?: boolean;
  role?: "admin" | "user" | "owner";
  isPrimaryOwner?: boolean;
  emailVerified?: boolean;
  accountStatus?: "active" | "banned" | "pending" | "pending_profile" | "ACTIVE" | "BANNED" | "PENDING" | "PENDING_PROFILE";
  avatarUrl?: string;
  signature?: string | null;
  totalTimeSpent?: number; // total study minutes spent in app
  lastActive?: string;
  studentGroup?: "A" | "B" | "C" | "D" | string;
}

export type SubjectId = "ID" | "NT" | "RM" | "CA" | "PHC" | "ImD" | "SSC";

export interface Subject {
  id: SubjectId;
  name: string;
  nameAr: string;
  icon: string; // Lucide icon identifier
  color: string; // hex or Tailwind color class
  description: string;
  modules: Module[];
}

export interface Module {
  id: string;
  subjectId: SubjectId;
  name: string;
  orderNumber: number;
  lectures: Lecture[];
}

export interface Lecture {
  id: string;
  moduleId: string;
  subjectId: SubjectId;
  title: string;
  doctorName: string;
  pdfUrl: string;
  notesPdfUrl: string;
  orderNumber: number;
  type: "Theory" | "Practical";
  category?: "Bacteriology" | "Parasitology" | "Virology" | "Mycology" | string; // Special for ID
  description: string;
  pages: string[]; // Mock PDF pages for in-app reading
  notesPages: string[]; // Mock Notes PDF pages with student highlight notes
  isDatabaseLecture?: boolean;
  materials?: Material[];
  mcqs?: MCQ[];
  flashcards?: Flashcard[];
}

export interface Material {
  id: string;
  title: string;
  type: string;
  fileUrlOrLink: string;
  lectureId: string;
  createdAt?: string;
  fileData?: unknown;
}

export interface DatabaseLecture {
  id: string;
  name: string;
  mainSubject: string;
  subSubject?: string | null;
  trackMode: string;
  department?: string | null;
  createdAt?: string;
  materials?: Material[];
  mcqs?: MCQ[];
  flashcards?: Flashcard[];
}

type MCQSourceType = "past_year" | "ai" | "book";

export interface MCQ {
  id: string;
  lectureId: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  /**
   * Withheld from client material payloads — the server returns the correct
   * answer key only after the quiz has been submitted (see /api/mcqs/submit).
   */
  correctAnswer?: "A" | "B" | "C" | "D";
  explanation: string;
  sourceType: MCQSourceType;
  sourceRef: string;
  difficulty: "Easy" | "Medium" | "Hard";
}

export interface Flashcard {
  id: string;
  lectureId: string;
  front: string;
  back: string;
}

export interface Video {
  id: string;
  lectureId: string;
  title: string;
  youtubeUrl: string; // e.g. "https://www.youtube.com/watch?v=..."
  durationSeconds: number;
  description: string;
}

export interface CommunityAnswer {
  id: string;
  questionId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  createdAt: string;
  upvotes: number;
  isBest: boolean;
  isBlocked?: boolean;
}

export interface CommunityQuestion {
  id: string;
  lectureId: string;
  user_id: string;
  userName: string;
  userAvatar: string;
  content: string;
  createdAt: string;
  upvotes: number;
  lectureTitle?: string;
  answers: CommunityAnswer[];
  isBlocked?: boolean;
}

type CalendarEventType = "lecture" | "exam" | "holiday" | "other";

export interface CalendarEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
  description: string;
  isPublic: boolean;
  subjectId?: SubjectId;
  lectureId?: string;
  eventType?: string; // Must strictly be one of: 'LECTURE', 'QUIZ', 'EXAM', 'HOLIDAY'
  startDateTime?: string | Date;
  endDateTime?: string | Date;
  targetGroups?: string[];
  room?: string;
  doctor?: string;
  attachments?: string[];
  notes?: string;
  isPinned?: boolean;
  isCompleted?: boolean;
}

export interface UserProgress {
  userId: string;
  lectureId: string;
  pdfCompleted: boolean;
  notesCompleted: boolean;
  videoCompleted: boolean;
  flashcardsCompleted: boolean;
  quizCompleted: boolean;
  quizScore?: number;
  lastAccessed: string;
}

interface PomodoroSession {
  id: string;
  userId: string;
  lectureId?: string;
  durationMinutes: number;
  completed: boolean;
  createdAt: string;
}

export interface PointsLog {
  id: string;
  userId: string;
  points: number;
  reason: string;
  createdAt: string;
}


export interface AppNotification {
  id: string;
  title: string;
  titleAr: string;
  desc: string;
  descAr: string;
  date: string;
  eventDate?: string;
  read: boolean;
  pinned?: boolean;
  type:
    | "lecture"
    | "event"
    | "quiz"
    | "exam"
    | "achievement"
    | "discussion"
    | "system"
    | "holiday"
    | "announcement";
}
