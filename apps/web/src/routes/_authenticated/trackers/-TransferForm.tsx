import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { z } from "zod";
import { Button } from "@/shadcn/ui/button";
import { Input } from "@/shadcn/ui/input";
import { Field, FieldLabel, FieldError } from "@/shadcn/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import type * as Schemas from "@app/schemas";
import { EntitiesQueries } from "../entities/-data";
import { getTodayLocalDate } from "./-utils";

// DEV_NOTE: the one compute-specific component in the app — rendered only when a tracker's
// manifest.compute is "money.transfer.v1", because a transfer is the one write no control can
// express (two entries, one transfer_group_id, opposite signs). Everything else the Money domain
// used to need is now the generic amount_pad control.
const ZTransferFormValues = z
  .object({
    fromAccountPublicId: z.string().min(1, "Choose a source account"),
    toAccountPublicId: z.string().min(1, "Choose a destination account"),
    amount: z.number().positive(),
    currency: z.string().length(3),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().nullable().optional(),
  })
  .refine((values) => values.fromAccountPublicId !== values.toAccountPublicId, {
    path: ["toAccountPublicId"],
    message: "Pick a different destination account",
  });
type TransferFormValues = z.infer<typeof ZTransferFormValues>;

interface TransferFormProps {
  onSubmit: (payload: Schemas.MoneyTransferComputeInput) => Promise<void>;
}

export function TransferForm({ onSubmit }: TransferFormProps) {
  const { getToken } = useAuth();
  const accountsQuery = useQuery(EntitiesQueries.list("account", getToken));
  const accounts = (accountsQuery.data?.entities ?? []).filter((account) => !account.archivedAt);

  const defaultValues: TransferFormValues = {
    fromAccountPublicId: "",
    toAccountPublicId: "",
    amount: 0,
    currency: "INR",
    date: getTodayLocalDate(),
    note: "",
  };

  const form = useForm({
    defaultValues,
    validators: { onSubmit: ZTransferFormValues },
    onSubmit: async ({ value }) => {
      await onSubmit({
        fromAccountPublicId: value.fromAccountPublicId,
        toAccountPublicId: value.toAccountPublicId,
        // DEV_NOTE: typed in major units, stored in minor — canonical units only (invariant 2).
        amountMinor: Math.round(value.amount * 100),
        currency: value.currency.toUpperCase(),
        date: value.date,
        note: value.note || null,
      });
      form.reset();
    },
  });

  if (accountsQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading accounts...</p>;
  }
  if (accountsQuery.isError) {
    return <p className="text-sm text-destructive">Failed to load accounts.</p>;
  }
  if (accounts.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        A transfer needs two accounts — create them under Entities first.
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {(["fromAccountPublicId", "toAccountPublicId"] as const).map((name) => (
        <form.Field key={name} name={name}>
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {name === "fromAccountPublicId" ? "From account" : "To account"}
                </FieldLabel>
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id={field.name} aria-invalid={isInvalid} className="w-full">
                    <SelectValue placeholder="Choose an account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts.map((account) => (
                        <SelectItem key={account.publicId} value={account.publicId}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            );
          }}
        </form.Field>
      ))}

      <div className="flex gap-4">
        <form.Field name="amount">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Amount</FieldLabel>
                <Input
                  id={field.name}
                  type="number"
                  step="0.01"
                  min="0"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                  onBlur={field.handleBlur}
                  aria-invalid={isInvalid}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="currency">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Currency</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                maxLength={3}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <form.Field name="date">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Date</FieldLabel>
            <Input
              id={field.name}
              type="date"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Note (optional)</FieldLabel>
            <Input
              id={field.name}
              value={field.state.value ?? ""}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </Field>
        )}
      </form.Field>

      <div className="flex justify-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Transferring..." : "Transfer"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
