import NotesDAL from "@/data-access-layer/NotesDAL";
import * as Schemas from "@app/schemas";

export default class NotesRepo {
  private dal: NotesDAL;

  constructor(env: Env) {
    this.dal = new NotesDAL(env);
  }

  private withStatusLabel(note: Schemas.Note): Schemas.NoteWithStatus {
    const { id: _id, ...rest } = note;
    return {
      ...rest,
      noteStatus: note.status,
      noteStatusLabel: Schemas.NOTE_STATUS_LABEL_MAP[note.status],
    };
  }

  async createNote(
    params: Schemas.CreateNoteApiRequest & { userId: string },
  ): Promise<Schemas.CreateNoteApiResponse> {
    const result = await this.dal.createNote({
      userId: params.userId,
      title: params.note.title,
      body: params.note.body,
    });
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      note: result.note ? this.withStatusLabel(result.note) : undefined,
    };
  }

  async getNoteDetails(params: {
    userId: string;
    publicId: string;
  }): Promise<Schemas.GetNoteApiResponse> {
    const result = await this.dal.getNoteDetails(params);
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      note: result.note ? this.withStatusLabel(result.note) : undefined,
    };
  }

  async getNotes(params: { userId: string }): Promise<Schemas.GetNotesApiResponse> {
    const result = await this.dal.getNotes(params);
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      notes: result.notes?.map((note) => this.withStatusLabel(note)),
    };
  }

  async updateNote(
    params: Schemas.UpdateNoteApiRequest & { userId: string; publicId: string },
  ): Promise<Schemas.UpdateNoteApiResponse> {
    const result = await this.dal.updateNote({
      publicId: params.publicId,
      userId: params.userId,
      title: params.note.title ?? null,
      body: params.note.body ?? null,
    });
    return {
      isSuccess: result.isSuccess,
      message: result.message,
      note: result.note ? this.withStatusLabel(result.note) : undefined,
    };
  }

  async deleteNote(params: { userId: string; publicId: string }) {
    return await this.dal.deleteNote(params);
  }
}
