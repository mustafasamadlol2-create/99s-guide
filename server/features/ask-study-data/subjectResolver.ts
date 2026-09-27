import type { StudyAnalyzerDto } from "../study-analyzer/types.js";
import { normalizeAskQuestion } from "./routing.js";

export type SubjectResolution =
  | { status: "ALL" }
  | { status: "MATCHED"; subjectId: string }
  | { status: "CLARIFICATION"; candidates: string[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function includesCanonicalName(question: string, name: string): boolean {
  const normalizedName = normalizeAskQuestion(name);
  if (normalizedName.length < 2) return false;
  const expression = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedName)}(?=$|[^\\p{L}\\p{N}])`,
    "u",
  );
  return expression.test(question);
}

function hasSpecificSubjectPhrase(question: string): boolean {
  const stripped = question
    .replace(/\b(?:last|past)\s+(?:7|30)\s+days?\b|\b(?:last|past|this|current)\s+(?:week|month|semester)\b|\b(?:currently|right now|recently|lately)\b/gu, " ")
    .replace(/(?:اخر|هذا)\s+(?:7|30)\s+ايام|(?:اخر|هذا|الحالي)\s+(?:اسبوع|شهر|فصل)|الفترة الاخيرة|الفصل الحالي|الاسبوع الحالي|الشهر الحالي/gu, " ");
  const match =
    /\b(?:in|for|about)\s+([\p{L}\p{N}][\p{L}\p{N}\s'-]{1,60})/u.exec(stripped) ??
    /\b(?:subject|course|material)\s+(?:named|called)\s+([\p{L}\p{N}][\p{L}\p{N}\s'-]{1,60})/u.exec(stripped) ??
    /(?:بمادة|في مادة|مادة)\s*([\p{L}\p{N}][\p{L}\p{N}\s'-]{1,60})/u.exec(stripped);
  if (!match?.[1]) return false;
  const candidate = normalizeAskQuestion(match[1]).replace(/[?!.,،؛].*$/u, "").trim();
  return !/^(?:the|a|an|me|my|myself|my own records|my study data|my records|my activity|me personally|activity|summary|data|facts|review|performance|نشاط|ملخص|بيانات|مراجعة|اداء)$/u.test(candidate);
}

export function resolveAskStudyDataSubject(
  question: string,
  dto: StudyAnalyzerDto,
): SubjectResolution {
  const normalized = normalizeAskQuestion(question);
  const subjects = [...new Set(dto.subjects.map((subject) => subject.subjectId))]
    .filter((subjectId) => subjectId.length > 0);
  const matches = subjects.filter((subjectId) => includesCanonicalName(normalized, subjectId));
  if (matches.length === 1) return { status: "MATCHED", subjectId: matches[0]! };
  if (matches.length > 1) {
    return { status: "CLARIFICATION", candidates: matches.slice(0, 5) };
  }
  if (hasSpecificSubjectPhrase(normalized)) {
    return { status: "CLARIFICATION", candidates: subjects.slice(0, 5) };
  }
  return { status: "ALL" };
}