export type OfficialCalendarEventType = "LECTURE" | "EXAM" | "HOLIDAY";

type Group = "A" | "B" | "C" | "D" | "E";
type TheoryStream = "A" | "B" | "C" | "DE";

interface DaySpec {
  date: string;
  thursday: boolean;
  practical: Partial<Record<Group, string>>;
  theory: Record<TheoryStream, [string, string]>;
}

export interface OfficialCalendarImportEvent {
  clientId: string;
  title: string;
  eventType: OfficialCalendarEventType;
  startDateTime: string;
  endDateTime: string;
  targetGroups: string[];
  allDay: boolean;
  sendNotification: false;
  description: string;
}

/**
 * Source: official YEAR 3 - TERM ONE TIMETABLE (2026-2027).
 * Imported range requested by the owner: 27 Sep 2026 through 1 Dec 2026 inclusive.
 * Room/hall columns and HV/online-FA side notes are intentionally excluded.
 */
export const YEAR3_TERM_ONE_2026_SOURCE_LABEL =
  "Official Year 3 Term One Timetable (2026-2027) — 27 Sep to 1 Dec 2026";

const DAY_SPECS: DaySpec[] = [
  {
    "date": "2026-09-27",
    "thursday": false,
    "practical": {
      "A": "CA-S1",
      "B": "ID-P1",
      "C": "RM-TBL1",
      "D": "ID-TBL1(Surg.)",
      "E": "NT-TBL1(Bioch.)"
    },
    "theory": {
      "A": [
        "ID-5 C.Med",
        "CA-4 ME"
      ],
      "B": [
        "CA-4 ME",
        "ID-5 C.Med"
      ],
      "C": [
        "RM-5",
        "ID-6 Micro"
      ],
      "DE": [
        "ID-6 Micro",
        "RM-5"
      ]
    }
  },
  {
    "date": "2026-09-28",
    "thursday": false,
    "practical": {
      "A": "NT-TBL1 (Bioch.)",
      "B": "CA-S1",
      "C": "ID-P1",
      "D": "RM-TBL1",
      "E": "ID-TBL1(Surg.)"
    },
    "theory": {
      "A": [
        "RM-5",
        "ID-6 Micro"
      ],
      "B": [
        "ID-6 Micro",
        "RM-5"
      ],
      "C": [
        "ID-5 C.Med",
        "CA-4 ME"
      ],
      "DE": [
        "CA-4 ME",
        "ID-5 C.Med"
      ]
    }
  },
  {
    "date": "2026-09-29",
    "thursday": false,
    "practical": {
      "A": "ID-TBL1(Surg.)",
      "B": "NT-TBL1 (Bioch.)",
      "C": "CA-S1",
      "D": "ID-P1",
      "E": "RM-TBL1"
    },
    "theory": {
      "A": [
        "ID-7 Med",
        "ID-8 Micro"
      ],
      "B": [
        "ID-8 Micro",
        "ID-7 Med"
      ],
      "C": [
        "RM-6",
        "ID-9 Med"
      ],
      "DE": [
        "ID-9 Med",
        "RM-6"
      ]
    }
  },
  {
    "date": "2026-09-30",
    "thursday": false,
    "practical": {
      "A": "RM-TBL1",
      "B": "ID-TBL1(Surg.)",
      "C": "NT-TBL1 (Bioch.)",
      "D": "CA-S1",
      "E": "ID-P1"
    },
    "theory": {
      "A": [
        "RM-6",
        "ID-9 Med"
      ],
      "B": [
        "ID-9 Med",
        "RM-6"
      ],
      "C": [
        "ID-7 Med",
        "ID-8 Micro"
      ],
      "DE": [
        "ID-8 Micro",
        "ID-7 Med"
      ]
    }
  },
  {
    "date": "2026-10-01",
    "thursday": true,
    "practical": {
      "A": "ID-P1",
      "B": "RM-TBL1",
      "C": "ID-TBL1(Surg.)",
      "D": "NT-TBL1 (Bioch.)",
      "E": "CA-S1"
    },
    "theory": {
      "A": [
        "NT-6 C.Med",
        "ID-10 Micro"
      ],
      "B": [
        "ID-10 Micro",
        "NT-6 C.Med"
      ],
      "C": [
        "ID-11 Micro",
        "ID-13 C.Med"
      ],
      "DE": [
        "ID-13 C.Med",
        "ID-11 Micro"
      ]
    }
  },
  {
    "date": "2026-10-04",
    "thursday": false,
    "practical": {
      "A": "CA-S2",
      "B": "ID-P2",
      "C": "RM-TBL2",
      "D": "ID-TBL2-Surg",
      "E": "CA-CS1"
    },
    "theory": {
      "A": [
        "ID-11 Micro",
        "ID-13 C.Med"
      ],
      "B": [
        "ID-13 C.Med",
        "ID-11 Micro"
      ],
      "C": [
        "NT-6 C.Med",
        "ID-10 Micro"
      ],
      "DE": [
        "ID-10 Micro",
        "NT-6 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-05",
    "thursday": false,
    "practical": {
      "A": "CA-CS1",
      "B": "CA-S2",
      "C": "ID-P2",
      "D": "RM-TBL2",
      "E": "ID-TBL2-Surg"
    },
    "theory": {
      "A": [
        "ID-12 Micro",
        "NT-7 Bioch."
      ],
      "B": [
        "NT-7 Bioch.",
        "ID-12 Micro"
      ],
      "C": [
        "ID-14 Micro",
        "ID-15 Micro"
      ],
      "DE": [
        "ID-15 Micro",
        "ID-14 Micro"
      ]
    }
  },
  {
    "date": "2026-10-06",
    "thursday": false,
    "practical": {
      "A": "ID-TBL2-Surg",
      "B": "CA-CS1",
      "C": "CA-S2",
      "D": "ID-P2",
      "E": "RM-TBL2"
    },
    "theory": {
      "A": [
        "ID-14 Micro",
        "ID-15 Micro"
      ],
      "B": [
        "ID-15 Micro",
        "ID-14 Micro"
      ],
      "C": [
        "ID-12 Micro",
        "NT-7 Bioch."
      ],
      "DE": [
        "NT-7 Bioch.",
        "ID-12 Micro"
      ]
    }
  },
  {
    "date": "2026-10-07",
    "thursday": false,
    "practical": {
      "A": "RM-TBL2",
      "B": "ID-TBL2-Surg",
      "C": "CA-CS1",
      "D": "CA-S2",
      "E": "ID-P2"
    },
    "theory": {
      "A": [
        "NT-8 C.Med",
        "ID-16 C.Med"
      ],
      "B": [
        "ID-16 C.Med",
        "NT-8 C.Med"
      ],
      "C": [
        "RM-7",
        "ID-17 Micro"
      ],
      "DE": [
        "ID-17 Micro",
        "RM-7"
      ]
    }
  },
  {
    "date": "2026-10-08",
    "thursday": true,
    "practical": {
      "A": "ID-P2",
      "B": "RM-TBL2",
      "C": "ID-TBL2-Surg",
      "D": "CA-CS1",
      "E": "CA-S2"
    },
    "theory": {
      "A": [
        "RM-7",
        "ID-17 Micro"
      ],
      "B": [
        "ID-17 Micro",
        "RM-7"
      ],
      "C": [
        "NT-8 C.Med",
        "ID-16 C.Med"
      ],
      "DE": [
        "ID-16 C.Med",
        "NT-8 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-11",
    "thursday": false,
    "practical": {
      "A": "CA-S3",
      "B": "ID-P3",
      "C": "RM-TBL3",
      "D": "PS1-SL",
      "E": "CA-CS2"
    },
    "theory": {
      "A": [
        "ID-18 Micro",
        "ID-19 Med"
      ],
      "B": [
        "ID-19 Med",
        "ID-18 Micro"
      ],
      "C": [
        "ID-21 Micro",
        "ID-20 Med"
      ],
      "DE": [
        "ID-20 Med",
        "ID-21 Micro"
      ]
    }
  },
  {
    "date": "2026-10-12",
    "thursday": false,
    "practical": {
      "A": "CA-CS2",
      "B": "CA-S3",
      "C": "ID-P3",
      "D": "RM-TBL3",
      "E": "PS1-SL"
    },
    "theory": {
      "A": [
        "ID-21 Micro",
        "ID-20 Med"
      ],
      "B": [
        "ID-20 Med",
        "ID-21 Micro"
      ],
      "C": [
        "ID-18 Micro",
        "ID-19 Med"
      ],
      "DE": [
        "ID-19 Med",
        "ID-18 Micro"
      ]
    }
  },
  {
    "date": "2026-10-13",
    "thursday": false,
    "practical": {
      "A": "PS1-SL",
      "B": "CA-CS2",
      "C": "CA-S3",
      "D": "ID-P3",
      "E": "RM-TBL3"
    },
    "theory": {
      "A": [
        "RM-8",
        "ID-22 Med"
      ],
      "B": [
        "ID-22 Med",
        "RM-8"
      ],
      "C": [
        "ID-24 Micro",
        "RM-9"
      ],
      "DE": [
        "RM-9",
        "ID-24 Micro"
      ]
    }
  },
  {
    "date": "2026-10-14",
    "thursday": false,
    "practical": {
      "A": "RM-TBL3",
      "B": "PS1-SL",
      "C": "CA-CS2",
      "D": "CA-S3",
      "E": "ID-P3"
    },
    "theory": {
      "A": [
        "ID-24 Micro",
        "RM-9"
      ],
      "B": [
        "RM-9",
        "ID-24 Micro"
      ],
      "C": [
        "RM-8",
        "ID-22 Med"
      ],
      "DE": [
        "ID-22 Med",
        "RM-8"
      ]
    }
  },
  {
    "date": "2026-10-15",
    "thursday": true,
    "practical": {
      "A": "ID-P3",
      "B": "RM-TBL3",
      "C": "PS1-SL",
      "D": "CA-CS2",
      "E": "CA-S3"
    },
    "theory": {
      "A": [
        "ID-23 C.Med",
        "ID-25 Micro"
      ],
      "B": [
        "ID-25 Micro",
        "ID-23 C.Med"
      ],
      "C": [
        "NT-9 Bioch.",
        "RM-10"
      ],
      "DE": [
        "RM-10",
        "NT-9 Bioch."
      ]
    }
  },
  {
    "date": "2026-10-18",
    "thursday": false,
    "practical": {
      "A": "CA-S4",
      "B": "ID-P4",
      "C": "RM-TBL4",
      "D": "ID-TBL3 Surg.",
      "E": "NT-TBL2 Bioch."
    },
    "theory": {
      "A": [
        "NT-9 Bioch.",
        "RM-10"
      ],
      "B": [
        "RM-10",
        "NT-9 Bioch."
      ],
      "C": [
        "ID-23 C.Med",
        "ID-25 Micro"
      ],
      "DE": [
        "ID-25 Micro",
        "ID-23 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-19",
    "thursday": false,
    "practical": {
      "A": "NT-TBL2 Bioch.",
      "B": "CA-S4",
      "C": "ID-P4",
      "D": "RM-TBL4",
      "E": "ID-TBL3 Surg."
    },
    "theory": {
      "A": [
        "RM-11",
        "NT-10 Bioch."
      ],
      "B": [
        "NT-10 Bioch.",
        "RM-11"
      ],
      "C": [
        "ID-26 Micro",
        "NT-11 Med"
      ],
      "DE": [
        "NT-11 Med",
        "ID-26 Micro"
      ]
    }
  },
  {
    "date": "2026-10-20",
    "thursday": false,
    "practical": {
      "A": "ID-TBL3 Surg.",
      "B": "NT-TBL2 Bioch.",
      "C": "CA-S4",
      "D": "ID-P4",
      "E": "RM-TBL4"
    },
    "theory": {
      "A": [
        "ID-26 Micro",
        "NT-11 Med"
      ],
      "B": [
        "NT-11 Med",
        "ID-26 Micro"
      ],
      "C": [
        "RM-11",
        "NT-10 Bioch."
      ],
      "DE": [
        "NT-10 Bioch.",
        "RM-11"
      ]
    }
  },
  {
    "date": "2026-10-21",
    "thursday": false,
    "practical": {
      "A": "RM-TBL4",
      "B": "ID-TBL3 Surg.",
      "C": "NT-TBL2 Bioch.",
      "D": "CA-S4",
      "E": "ID-P4"
    },
    "theory": {
      "A": [
        "NT-12 Med",
        "RM-12"
      ],
      "B": [
        "RM-12",
        "NT-12 Med"
      ],
      "C": [
        "NT-13 C.Med",
        "ID-27 Med"
      ],
      "DE": [
        "ID-27 Med",
        "NT-13 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-22",
    "thursday": true,
    "practical": {
      "A": "ID-P4",
      "B": "RM-TBL4",
      "C": "ID-TBL3 Surg.",
      "D": "NT-TBL2 Bioch.",
      "E": "CA-S4"
    },
    "theory": {
      "A": [
        "NT-13 C.Med",
        "ID-27 Med"
      ],
      "B": [
        "ID-27 Med",
        "NT-13 C.Med"
      ],
      "C": [
        "NT-12 Med",
        "RM-12"
      ],
      "DE": [
        "RM-12",
        "NT-12 Med"
      ]
    }
  },
  {
    "date": "2026-10-25",
    "thursday": false,
    "practical": {
      "A": "CA-S5",
      "B": "ID-TBL4 Micro",
      "C": "RM-TBL5",
      "D": "CA-PS2-SL",
      "E": "NT-TBL3 C.Med"
    },
    "theory": {
      "A": [
        "RM-13",
        "NT-14 Bioch."
      ],
      "B": [
        "NT-14 Bioch.",
        "RM-13"
      ],
      "C": [
        "ID-28 Med",
        "ID-29 C.Med"
      ],
      "DE": [
        "ID-29 C.Med",
        "ID-28 Med"
      ]
    }
  },
  {
    "date": "2026-10-26",
    "thursday": false,
    "practical": {
      "A": "NT-TBL3 C.Med",
      "B": "CA-S5",
      "C": "ID-TBL4 Micro",
      "D": "RM-TBL5",
      "E": "CA-PS2-SL"
    },
    "theory": {
      "A": [
        "ID-28 Med",
        "ID-29 C.Med"
      ],
      "B": [
        "ID-29 C.Med",
        "ID-28 Med"
      ],
      "C": [
        "RM-13",
        "NT-14 Bioch."
      ],
      "DE": [
        "NT-14 Bioch.",
        "RM-13"
      ]
    }
  },
  {
    "date": "2026-10-27",
    "thursday": false,
    "practical": {
      "A": "CA-PS2-SL",
      "B": "NT-TBL3 C.Med",
      "C": "CA-S5",
      "D": "ID-TBL4 Micro",
      "E": "RM-TBL5"
    },
    "theory": {
      "A": [
        "ID-30 C.Med",
        "NT-15 Bioch."
      ],
      "B": [
        "NT-15 Bioch.",
        "ID-30 C.Med"
      ],
      "C": [
        "NT-16 C.Med",
        "ID-31 Micro"
      ],
      "DE": [
        "ID-31 Micro",
        "NT-16 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-28",
    "thursday": false,
    "practical": {
      "A": "RM-TBL5",
      "B": "CA-PS2-SL",
      "C": "NT-TBL3 C.Med",
      "D": "CA-S5",
      "E": "ID-TBL4 Micro"
    },
    "theory": {
      "A": [
        "NT-16 C.Med",
        "ID-31 Micro"
      ],
      "B": [
        "ID-31 Micro",
        "NT-16 C.Med"
      ],
      "C": [
        "ID-30 C.Med",
        "NT-15 Bioch."
      ],
      "DE": [
        "NT-15 Bioch.",
        "ID-30 C.Med"
      ]
    }
  },
  {
    "date": "2026-10-29",
    "thursday": true,
    "practical": {
      "A": "ID-TBL4 Micro",
      "B": "RM-TBL5",
      "C": "CA-PS2-SL",
      "D": "NT-TBL3 C.Med",
      "E": "CA-S5"
    },
    "theory": {
      "A": [
        "ID-32 Micro",
        "CA-5"
      ],
      "B": [
        "CA-5",
        "ID-32 Micro"
      ],
      "C": [
        "ID-33 Micro",
        "ID-35 C.Med"
      ],
      "DE": [
        "ID-35 C.Med",
        "ID-33 Micro"
      ]
    }
  },
  {
    "date": "2026-11-08",
    "thursday": false,
    "practical": {
      "A": "CA-S6",
      "B": "ID-P5",
      "C": "RM-TBL6",
      "D": "CA-SS1 Surg.",
      "E": "ID-TBL5 Med"
    },
    "theory": {
      "A": [
        "ID-33 Micro",
        "ID-35 C.Med"
      ],
      "B": [
        "ID-35 C.Med",
        "ID-33 Micro"
      ],
      "C": [
        "ID-32 Micro",
        "CA-5"
      ],
      "DE": [
        "CA-5",
        "ID-32 Micro"
      ]
    }
  },
  {
    "date": "2026-11-09",
    "thursday": false,
    "practical": {
      "A": "ID-TBL5 Med",
      "B": "CA-S6",
      "C": "ID-P5",
      "D": "RM-TBL6",
      "E": "CA-SS1 Surg."
    },
    "theory": {
      "A": [
        "RM-14",
        "NT-17 C.Med"
      ],
      "B": [
        "NT-17 C.Med",
        "RM-14"
      ],
      "C": [
        "ID-34 Med",
        "NT-18 C.Med"
      ],
      "DE": [
        "NT-18 C.Med",
        "ID-34 Med"
      ]
    }
  },
  {
    "date": "2026-11-10",
    "thursday": false,
    "practical": {
      "A": "CA-SS1 Surg.",
      "B": "ID-TBL5 Med",
      "C": "CA-S6",
      "D": "ID-P5",
      "E": "RM-TBL6"
    },
    "theory": {
      "A": [
        "ID-34 Med",
        "NT-18 C.Med"
      ],
      "B": [
        "NT-18 C.Med",
        "ID-34 Med"
      ],
      "C": [
        "RM-14",
        "NT-17 C.Med"
      ],
      "DE": [
        "NT-17 C.Med",
        "RM-14"
      ]
    }
  },
  {
    "date": "2026-11-11",
    "thursday": false,
    "practical": {
      "A": "RM-TBL6",
      "B": "CA-SS1 Surg.",
      "C": "ID-TBL5 Med",
      "D": "CA-S6",
      "E": "ID-P5"
    },
    "theory": {
      "A": [
        "ID-36 Med",
        "NT-19 Med"
      ],
      "B": [
        "NT-19 Med",
        "ID-36 Med"
      ],
      "C": [
        "NT-20 Med",
        "ID-37 C.Med"
      ],
      "DE": [
        "ID-37 C.Med",
        "NT-20 Med"
      ]
    }
  },
  {
    "date": "2026-11-12",
    "thursday": true,
    "practical": {
      "A": "ID-P5",
      "B": "RM-TBL6",
      "C": "CA-SS1 Surg.",
      "D": "ID-TBL5 Med",
      "E": "CA-S6"
    },
    "theory": {
      "A": [
        "NT-20 Med",
        "ID-37 C.Med"
      ],
      "B": [
        "ID-37 C.Med",
        "NT-20 Med"
      ],
      "C": [
        "ID-36 Med",
        "NT-19 Med"
      ],
      "DE": [
        "NT-19 Med",
        "ID-36 Med"
      ]
    }
  },
  {
    "date": "2026-11-15",
    "thursday": false,
    "practical": {
      "A": "CA-S7",
      "C": "RM-TBL7",
      "D": "CA-SS2 Surg."
    },
    "theory": {
      "A": [
        "RM-15",
        "ID-38 Micro"
      ],
      "B": [
        "ID-38 Micro",
        "RM-15"
      ],
      "C": [
        "ID-39 Micro",
        "NT-21 C.Med"
      ],
      "DE": [
        "NT-21 C.Med",
        "ID-39 Micro"
      ]
    }
  },
  {
    "date": "2026-11-16",
    "thursday": false,
    "practical": {
      "B": "CA-S7",
      "D": "RM-TBL7",
      "E": "CA-SS2 Surg."
    },
    "theory": {
      "A": [
        "ID-39 Micro",
        "NT-21 C.Med"
      ],
      "B": [
        "NT-21 C.Med",
        "ID-39 Micro"
      ],
      "C": [
        "RM-15",
        "ID-38 Micro"
      ],
      "DE": [
        "ID-38 Micro",
        "RM-15"
      ]
    }
  },
  {
    "date": "2026-11-17",
    "thursday": false,
    "practical": {
      "A": "CA-SS2 Surg.",
      "C": "CA-S7",
      "E": "RM-TBL7"
    },
    "theory": {
      "A": [
        "ID-40 Micro",
        "NT-22 C.Med"
      ],
      "B": [
        "NT-22 C.Med",
        "ID-40 Micro"
      ],
      "C": [
        "NT-23 Bioch.",
        "ID-41 Micro"
      ],
      "DE": [
        "ID-41 Micro",
        "NT-23 Bioch."
      ]
    }
  },
  {
    "date": "2026-11-18",
    "thursday": false,
    "practical": {
      "A": "RM-TBL7",
      "B": "CA-SS2 Surg.",
      "D": "CA-S7"
    },
    "theory": {
      "A": [
        "NT-23 Bioch.",
        "ID-41 Micro"
      ],
      "B": [
        "ID-41 Micro",
        "NT-23 Bioch."
      ],
      "C": [
        "ID-40 Micro",
        "NT-22 C.Med"
      ],
      "DE": [
        "NT-22 C.Med",
        "ID-40 Micro"
      ]
    }
  },
  {
    "date": "2026-11-19",
    "thursday": true,
    "practical": {
      "B": "RM-TBL7",
      "C": "CA-SS2 Surg.",
      "E": "CA-S7"
    },
    "theory": {
      "A": [
        "ID-42 Med",
        "ID-43 Micro"
      ],
      "B": [
        "ID-43 Micro",
        "ID-42 Med"
      ],
      "C": [
        "ID-44 Med",
        "NT-24 C.Med"
      ],
      "DE": [
        "NT-24 C.Med",
        "ID-44 Med"
      ]
    }
  },
  {
    "date": "2026-11-22",
    "thursday": false,
    "practical": {
      "A": "CA-S8",
      "B": "ID-P6",
      "C": "RM-TBL8",
      "D": "CA-SS3 Surg."
    },
    "theory": {
      "A": [
        "ID-44 Med",
        "NT-24 C.Med"
      ],
      "B": [
        "NT-24 C.Med",
        "ID-44 Med"
      ],
      "C": [
        "ID-42 Med",
        "ID-43 Micro"
      ],
      "DE": [
        "ID-43 Micro",
        "ID-42 Med"
      ]
    }
  },
  {
    "date": "2026-11-23",
    "thursday": false,
    "practical": {
      "B": "CA-S8",
      "C": "ID-P6",
      "D": "RM-TBL8",
      "E": "CA-SS3 Surg."
    },
    "theory": {
      "A": [
        "ID-45 Micro",
        "ID-46 Med"
      ],
      "B": [
        "ID-46 Med",
        "ID-45 Micro"
      ],
      "C": [
        "ID-47 Micro",
        "ID-48 Micro"
      ],
      "DE": [
        "ID-48 Micro",
        "ID-47 Micro"
      ]
    }
  },
  {
    "date": "2026-11-24",
    "thursday": false,
    "practical": {
      "A": "CA-SS3 Surg.",
      "C": "CA-S8",
      "D": "ID-P6",
      "E": "RM-TBL8"
    },
    "theory": {
      "A": [
        "ID-47 Micro",
        "ID-48 Micro"
      ],
      "B": [
        "ID-48 Micro",
        "ID-47 Micro"
      ],
      "C": [
        "ID-45 Micro",
        "ID-46 Med"
      ],
      "DE": [
        "ID-46 Med",
        "ID-45 Micro"
      ]
    }
  },
  {
    "date": "2026-11-25",
    "thursday": false,
    "practical": {
      "A": "RM-TBL8",
      "B": "CA-SS3 Surg.",
      "D": "CA-S8",
      "E": "ID-P6"
    },
    "theory": {
      "A": [
        "ID-49 Micro",
        "RM-16"
      ],
      "B": [
        "RM-16",
        "ID-49 Micro"
      ],
      "C": [
        "ID-50 Micro",
        "RM-17"
      ],
      "DE": [
        "RM-17",
        "ID-50 Micro"
      ]
    }
  },
  {
    "date": "2026-11-26",
    "thursday": true,
    "practical": {
      "A": "ID-P6",
      "B": "RM-TBL8",
      "C": "CA-SS3 Surg.",
      "E": "CA-S8"
    },
    "theory": {
      "A": [
        "ID-50 Micro",
        "RM-17"
      ],
      "B": [
        "RM-17",
        "ID-50 Micro"
      ],
      "C": [
        "ID-49 Micro",
        "RM-16"
      ],
      "DE": [
        "RM-16",
        "ID-49 Micro"
      ]
    }
  },
  {
    "date": "2026-11-29",
    "thursday": false,
    "practical": {
      "A": "CA-S9",
      "B": "ID-P7",
      "C": "RM-TBL9",
      "D": "CA-SS4 Surg."
    },
    "theory": {
      "A": [
        "ID-51 Micro",
        "RM-18"
      ],
      "B": [
        "RM-18",
        "ID-51 Micro"
      ],
      "C": [
        "ID-52 Med",
        "NT-25 Med"
      ],
      "DE": [
        "NT-25 Med",
        "ID-52 Med"
      ]
    }
  },
  {
    "date": "2026-11-30",
    "thursday": false,
    "practical": {
      "B": "CA-S9",
      "C": "ID-P7",
      "D": "RM-TBL9",
      "E": "CA-SS4 Surg."
    },
    "theory": {
      "A": [
        "ID-52 Med",
        "NT-25 Med"
      ],
      "B": [
        "NT-25 Med",
        "ID-52 Med"
      ],
      "C": [
        "ID-51 Micro",
        "RM-18"
      ],
      "DE": [
        "RM-18",
        "ID-51 Micro"
      ]
    }
  },
  {
    "date": "2026-12-01",
    "thursday": false,
    "practical": {
      "A": "CA-SS4 Surg.",
      "C": "CA-S9",
      "D": "ID-P7",
      "E": "RM-TBL9"
    },
    "theory": {
      "A": [
        "ID-53 Micro",
        "NT-26 Physio"
      ],
      "B": [
        "NT-26 Physio",
        "ID-53 Micro"
      ],
      "C": [
        "ID-54 Micro",
        "NT-27 Med"
      ],
      "DE": [
        "NT-27 Med",
        "ID-54 Micro"
      ]
    }
  }
];

const WEEKEND_DATES = [
  "2026-10-02",
  "2026-10-03",
  "2026-10-09",
  "2026-10-10",
  "2026-10-16",
  "2026-10-17",
  "2026-10-23",
  "2026-10-24",
  "2026-10-30",
  "2026-10-31",
  "2026-11-06",
  "2026-11-07",
  "2026-11-13",
  "2026-11-14",
  "2026-11-20",
  "2026-11-21",
  "2026-11-27",
  "2026-11-28"
] as const;

const IMPORTANT_EXAMS = [
  { date: "2026-11-02", title: "NT Mid Module Exam" },
  { date: "2026-11-03", title: "RM Mid Module Exam" },
] as const;

export const YEAR3_TERM_ONE_2026_COUNTS = {
  lectures: 541,
  weekendHolidays: 18,
  importantExams: 2,
  total: 561,
} as const;

function baghdadDateTime(date: string, time: string): string {
  return `${date}T${time}:00+03:00`;
}

function eventClientId(
  date: string,
  start: string,
  end: string,
  groups: readonly string[],
  title: string,
): string {
  return [
    "year3-term1-2026",
    date,
    start,
    end,
    groups.join("-"),
    title,
  ].join("|");
}

function timedLecture(
  date: string,
  title: string,
  start: string,
  end: string,
  targetGroups: string[],
): OfficialCalendarImportEvent {
  return {
    clientId: eventClientId(date, start, end, targetGroups, title),
    title,
    eventType: "LECTURE",
    startDateTime: baghdadDateTime(date, start),
    endDateTime: baghdadDateTime(date, end),
    targetGroups,
    allDay: false,
    sendNotification: false,
    description: YEAR3_TERM_ONE_2026_SOURCE_LABEL,
  };
}

function allDayEvent(
  date: string,
  title: string,
  eventType: "EXAM" | "HOLIDAY",
): OfficialCalendarImportEvent {
  return {
    clientId: eventClientId(date, "00:00", "23:59", ["ALL"], title),
    title,
    eventType,
    startDateTime: baghdadDateTime(date, "00:00"),
    endDateTime: baghdadDateTime(date, "23:59"),
    targetGroups: ["ALL"],
    allDay: true,
    sendNotification: false,
    description: YEAR3_TERM_ONE_2026_SOURCE_LABEL,
  };
}

export function buildYear3TermOne2026Events(): OfficialCalendarImportEvent[] {
  const events: OfficialCalendarImportEvent[] = [];

  for (const day of DAY_SPECS) {
    const practicalStart = day.thursday ? "09:00" : "08:00";
    const practicalEnd = day.thursday ? "12:00" : "11:00";

    for (const group of ["A", "B", "C", "D", "E"] as const) {
      const title = day.practical[group]?.trim();
      if (!title) continue;
      events.push(timedLecture(day.date, title, practicalStart, practicalEnd, [group]));
    }

    const firstTheorySlot = day.thursday
      ? (["12:00", "13:00"] as const)
      : (["11:00", "12:00"] as const);
    const secondTheorySlot = day.thursday
      ? (["13:00", "14:00"] as const)
      : (["12:00", "13:00"] as const);

    const streams: Array<{ key: TheoryStream; groups: string[] }> = [
      { key: "A", groups: ["A"] },
      { key: "B", groups: ["B"] },
      { key: "C", groups: ["C"] },
      { key: "DE", groups: ["D", "E"] },
    ];

    for (const stream of streams) {
      const [firstTitle, secondTitle] = day.theory[stream.key];
      if (firstTitle?.trim()) {
        events.push(
          timedLecture(
            day.date,
            firstTitle.trim(),
            firstTheorySlot[0],
            firstTheorySlot[1],
            stream.groups,
          ),
        );
      }
      if (secondTitle?.trim()) {
        events.push(
          timedLecture(
            day.date,
            secondTitle.trim(),
            secondTheorySlot[0],
            secondTheorySlot[1],
            stream.groups,
          ),
        );
      }
    }
  }

  for (const date of WEEKEND_DATES) {
    events.push(allDayEvent(date, "Weekend", "HOLIDAY"));
  }

  for (const exam of IMPORTANT_EXAMS) {
    events.push(allDayEvent(exam.date, exam.title, "EXAM"));
  }

  return events.sort((a, b) =>
    a.startDateTime.localeCompare(b.startDateTime) ||
    a.endDateTime.localeCompare(b.endDateTime) ||
    a.title.localeCompare(b.title),
  );
}
