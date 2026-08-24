import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";

import { SubjectId } from "../types";

interface TreeSubject {
  name: string;
  subSubjects: string[] | null;
  tracks: string[];
  departments:
    Record<string, string[]> | Record<string, Record<string, string[]>>;
}

const treeConfig: Record<SubjectId, TreeSubject> = {
  ID: {
    name: "Infectious Diseases",
    subSubjects: ["Bacteriology", "Parasitology", "Virology", "Mycology"],
    tracks: ["Theory", "Practical"],
    departments: {
      Bacteriology: {
        Theory: ["Microbiology", "Medicine", "Community Medicine"],
        Practical: ["Microbiology", "Medicine", "Surgery"],
      },
      Parasitology: {
        Theory: ["Microbiology", "Medicine", "Community Medicine", "Surgery"],
        Practical: ["Microbiology", "Community Medicine"],
      },
      Virology: {
        Theory: ["Microbiology", "Medicine", "Community Medicine"],
        Practical: ["Microbiology", "Medicine"],
      },
      Mycology: {
        Theory: ["Microbiology", "Medicine"],
        Practical: [], // NONE (Skipped to Lecture)
      },
    } as any,
  },
  NT: {
    name: "Nutrition",
    subSubjects: null,
    tracks: ["Theory", "Practical"],
    departments: {
      Theory: [
        "Biochemistry",
        "Medicine",
        "Community Medicine",
        "Physiology",
        "Surgery",
        "IEL",
      ],
      Practical: ["Biochemistry", "Medicine", "Community Medicine", "Surgery"],
    },
  },
  CA: {
    name: "Clinical Attachment",
    subSubjects: null,
    tracks: ["Theory", "Practical"],
    departments: {
      Theory: [], // NONE
      Practical: [
        "Surgery",
        "Medicine",
        "Communication Skills",
        "Practical Skills Lab",
      ],
    },
  },
  RM: {
    name: "Research Methodology",
    subSubjects: null,
    tracks: ["Theory", "TBL"],
    departments: {
      Theory: [], // NONE
      TBL: [], // NONE
    },
  },
  PHC: {
    name: "Public Health Care",
    subSubjects: null,
    tracks: ["Theory", "TBL"],
    departments: {
      Theory: [], // NONE
      TBL: [], // NONE
    },
  },
  SSC: {
    name: "Student Selected Component",
    subSubjects: null,
    tracks: ["Theory", "TBL"],
    departments: {
      Theory: [], // NONE
      TBL: [], // NONE
    },
  },
  ImD: {
    name: "Immune Disturbances",
    subSubjects: null,
    tracks: ["Theory", "TBL"],
    departments: {
      Theory: ["Microbiology", "Medicine"],
      TBL: ["Microbiology", "Medicine"],
    },
  },
};

export function useTreeSelection(initialValues?: {
  mainSubject?: SubjectId | null;
  subSubject?: string | null;
  trackMode?: string | null;
  department?: string | null;
}) {
  const [mainSubject, setMainSubjectState] = useState<SubjectId | null>(
    initialValues?.mainSubject ?? null,
  );
  const [subSubject, setSubSubjectState] = useState<string | null>(
    initialValues?.subSubject ?? null,
  );
  const [trackMode, setTrackModeState] = useState<string | null>(
    initialValues?.trackMode ?? null,
  );
  const [department, setDepartmentState] = useState<string | null>(
    initialValues?.department ?? null,
  );

  // Derive options based on current state
  const subjectConfig = mainSubject ? treeConfig[mainSubject] : null;
  const subSubjectOptions = subjectConfig?.subSubjects ?? [];
  const trackModeOptions = subjectConfig?.tracks ?? [];

  let departmentOptions: string[] = [];
  if (subjectConfig) {
    if (subjectConfig.subSubjects && subSubject) {
      const subDeptMap = (subjectConfig.departments as any)[subSubject];
      if (subDeptMap && trackMode) {
        departmentOptions = subDeptMap[trackMode] ?? [];
      }
    } else if (!subjectConfig.subSubjects && trackMode) {
      departmentOptions = (subjectConfig.departments as any)[trackMode] ?? [];
    }
  }

  // Auto-reset dependent states if the parent state is changed to an invalid state.
  const setMainSubject = (subject: SubjectId | null) => {
    setMainSubjectState(subject);
    setSubSubjectState(null);
    setTrackModeState(null);
    setDepartmentState(null);
  };

  const setSubSubject = (sub: string | null) => {
    setSubSubjectState(sub);
    setTrackModeState(null);
    setDepartmentState(null);
  };

  const setTrackMode = (track: string | null) => {
    setTrackModeState(track);
    setDepartmentState(null);
  };

  const setDepartment = (dept: string | null) => {
    setDepartmentState(dept);
  };

  // Determine if user can proceed to lecture selection/creation
  const deservesSubSubject =
    subjectConfig?.subSubjects && subjectConfig.subSubjects.length > 0;
  const isSubSubjectOk = deservesSubSubject
    ? subSubject !== null && subSubject !== ""
    : true;
  const isTrackOk = trackMode !== null && trackMode !== "";
  const isMainSubjectOk = mainSubject !== null;

  const requiresDepartmentSelection = departmentOptions.length > 0;
  const isDepartmentOk = requiresDepartmentSelection
    ? department !== null && department !== ""
    : true;

  const canProceedToLecture =
    isMainSubjectOk && isSubSubjectOk && isTrackOk && isDepartmentOk;

  return {
    // State
    mainSubject,
    subSubject,
    trackMode,
    department,

    // Setters
    setMainSubject,
    setSubSubject,
    setTrackMode,
    setDepartment,

    // Derived lists
    subSubjectOptions,
    trackModeOptions,
    departmentOptions,

    // Flags
    requiresDepartmentSelection,
    canProceedToLecture,
    treeConfig,
  };
}
