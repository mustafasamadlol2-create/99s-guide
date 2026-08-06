/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Subject,
  MCQ,
  Flashcard,
  Video,
  CommunityQuestion,
  CalendarEvent,
  User,
} from "../types";

// Pre-seeded User profiles for the leaderboard removed
export const subjects: Subject[] = [
  {
    id: "ID",
    name: "Infection Diseases",
    nameAr: "",
    icon: "Virus",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    description: "",
    modules: [
      {
        id: "id_m1",
        subjectId: "ID",
        name: "Bacteriology",
        orderNumber: 1,
        lectures: [],
      },
      {
        id: "id_m2",
        subjectId: "ID",
        name: "Parasitology",
        orderNumber: 2,
        lectures: [],
      },
      {
        id: "id_m3",
        subjectId: "ID",
        name: "Virology",
        orderNumber: 3,
        lectures: [],
      },
      {
        id: "id_m4",
        subjectId: "ID",
        name: "Mycology",
        orderNumber: 4,
        lectures: [],
      },
    ],
  },
  {
    id: "NT",
    name: "Nutrition",
    nameAr: "",
    icon: "Apple",
    color: "bg-purple-50 text-purple-700 border-purple-200",
    description: "",
    modules: [
      {
        id: "nt_m1",
        subjectId: "NT",
        name: "The Brainstem & Cranial Nerves",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
  {
    id: "RM",
    name: "Research Methodology",
    nameAr: "",
    icon: "ClipboardList",
    color: "bg-sky-50 text-sky-700 border-sky-200",
    description: "",
    modules: [
      {
        id: "rm_m1",
        subjectId: "RM",
        name: "Epidemiological Study Designs",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
  {
    id: "CA",
    name: "Clinical Attachment",
    nameAr: "",
    icon: "Hospital",
    color: "bg-rose-50 text-rose-700 border-rose-200",
    description: "",
    modules: [
      {
        id: "ca_m1",
        subjectId: "CA",
        name: "Valvular Heart Diseases",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
  {
    id: "PHC",
    name: "Public Health Care",
    nameAr: "",
    icon: "Users",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    description: "",
    modules: [
      {
        id: "phc_m1",
        subjectId: "PHC",
        name: "National Immunization Strategies",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
  {
    id: "ImD",
    name: "Immune Disturbance",
    nameAr: "",
    icon: "ShieldPlus",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    description: "",
    modules: [
      {
        id: "imd_m1",
        subjectId: "ImD",
        name: "Hypersensitivity States",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
  {
    id: "SSC",
    name: "Student Selected Component",
    nameAr: "",
    icon: "PersonPresentation",
    color: "bg-neutral-50 text-neutral-700 border-neutral-200",
    description: "",
    modules: [
      {
        id: "ssc_m1",
        subjectId: "SSC",
        name: "Wound Repair & Sutures",
        orderNumber: 1,
        lectures: [],
      },
    ],
  },
];

export const mcqs: MCQ[] = [];

export const flashcards: Flashcard[] = [];

export const videos: Video[] = [];

export const initialQuestions: CommunityQuestion[] = [];

export const initialCalendarEvents: CalendarEvent[] = [];
