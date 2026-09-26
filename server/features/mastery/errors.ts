export class LectureMasteryError extends Error {
  readonly code: "INVALID_INPUT" | "LECTURE_NOT_FOUND" | "PROJECTION_NOT_FOUND";

  constructor(
    code: LectureMasteryError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LectureMasteryError";
    this.code = code;
  }
}