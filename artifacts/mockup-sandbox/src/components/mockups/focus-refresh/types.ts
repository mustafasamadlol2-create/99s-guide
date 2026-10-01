export interface DatabaseLecture {
  id: string;
  name: string;
  mainSubject: string;
  subSubject?: string | null;
  trackMode: string;
}

export interface Subject {
  id: string;
  name: string;
  nameAr: string;
}