import type { NullableDALFields } from "../common";
import type { Note, NoteBase } from "./NotesCommon";

export type CreateNoteDALRequest = NoteBase & Pick<Note, "userId">;

// Params to find a note by its ID and user ID (for authorization)
export type FindNoteDALRequest = Pick<Note, "id" | "userId">;

export type GetNotesDALRequest = Pick<Note, "userId">;

export type UpdateNoteDALRequest = FindNoteDALRequest &
  NullableDALFields<Omit<Note, "id" | "userId" | "createdAt">>;
