import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import type * as Schemas from "@app/schemas";
import { useDeleteNote } from "./-data";
import { Link } from "@tanstack/react-router";
import { Button } from "@/shadcn/ui/button";

const NoteCard = ({ note }: { note: Schemas.Note }) => {
  const deleteMutation = useDeleteNote();

  return (
    <Link to="/notes/$noteId" params={{ noteId: String(note.id) }}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{note.title}</CardTitle>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate(note.id)}
          >
            Delete
          </Button>
        </CardHeader>
        {note.body && (
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-2">{note.body}</p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
};
export default NoteCard;
