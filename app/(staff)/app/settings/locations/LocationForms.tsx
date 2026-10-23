"use client";

// The lead's location forms (Phase 7 T4.5): "Add location" on the list page and "Save location" on a location's own
// page. Accessible names are the e2e contract (e2e/locations.spec.ts): "Name on the poster", "Answer the form starts
// with", "More detail (optional)", the group "Is this location in use?", "Add location" and "Save location". The
// server action validates everything again; errors come back inline with an ErrorSummary, the result is one focused
// line under the page header (ActionFeedbackProvider on the page).
import { useCallback, useRef } from "react";
import { MapPinPlus, Save } from "lucide-react";
import { fieldErrorItems, useFormAction } from "@/components/ui/ActionFeedback";
import { Button } from "@/components/ui/Button";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { SelectField } from "@/components/ui/Select";
import { LOCATION_OPTIONS, type LocationKindValue } from "@/lib/intake/types";
import { LOCATION_DETAIL_MAX, LOCATION_NAME_MAX } from "@/lib/locations/input";
import { addLocation, saveLocation } from "./actions";

export interface LocationValues {
  id: string;
  name: string;
  kind: LocationKindValue;
  detail: string;
  active: boolean;
}

const KIND_OPTIONS = LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

/** The three fields both forms share; `prefix` keeps ids unique when both could be on one page. */
function LocationFields({
  prefix,
  initial,
  errors,
}: {
  prefix: string;
  initial?: Pick<LocationValues, "name" | "kind" | "detail">;
  errors: Record<string, string>;
}) {
  return (
    <>
      <TextField
        id={`${prefix}-name`}
        name="name"
        label="Name on the poster"
        hint={`The place’s name, printed large on the poster and filled into the form’s “Where exactly?” box. For example: Main Street branch, or Phone banking line. Up to ${LOCATION_NAME_MAX} characters.`}
        defaultValue={initial?.name ?? ""}
        maxLength={LOCATION_NAME_MAX * 2}
        autoComplete="off"
        required
        error={errors.name}
      />
      <SelectField
        id={`${prefix}-kind`}
        name="kind"
        label="Answer the form starts with"
        hint="The report form asks “Where did it happen?” People who scan this poster find this answer chosen, and can change it."
        options={KIND_OPTIONS}
        placeholderOption={initial ? undefined : "Choose an answer"}
        defaultValue={initial?.kind ?? ""}
        selectWidth="medium"
        required
        error={errors.kind}
      />
      <TextField
        id={`${prefix}-detail`}
        name="detail"
        label="More detail (optional)"
        hint={`Printed under the name, and added after it in the “Where exactly?” box. For example: front entrance, or 2nd floor washrooms. Up to ${LOCATION_DETAIL_MAX} characters.`}
        defaultValue={initial?.detail ?? ""}
        maxLength={LOCATION_DETAIL_MAX * 2}
        autoComplete="off"
        error={errors.detail}
      />
    </>
  );
}

/** "Add a location": the form empties itself after a location is added (the result line says which). */
export function AddLocationForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const onSuccess = useCallback(() => formRef.current?.reset(), []);
  const { onSubmit, pending, errors } = useFormAction(addLocation, { onSuccess });
  const e = errors?.fields ?? {};
  return (
    <form ref={formRef} onSubmit={onSubmit} method="post" noValidate className="grid gap-6">
      <ErrorSummary errors={fieldErrorItems(errors, { name: "add-name", kind: "add-kind", detail: "add-detail" })} focusKey={errors?.at} />
      <LocationFields prefix="add" errors={e} />
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={MapPinPlus} />}>
          Add location
        </Button>
      </div>
    </form>
  );
}

/** One location's details and whether it is in use ("Retired": its posters open the form without the place). */
export function EditLocationForm({ initial }: { initial: LocationValues }) {
  const { onSubmit, pending, errors } = useFormAction(saveLocation);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate className="grid gap-6">
      <ErrorSummary
        errors={fieldErrorItems(errors, { name: "edit-name", kind: "edit-kind", detail: "edit-detail", status: "edit-status-0" })}
        focusKey={errors?.at}
      />
      <input type="hidden" name="id" value={initial.id} />
      <LocationFields prefix="edit" initial={initial} errors={e} />
      <RadioGroup
        id="edit-status"
        name="status"
        legend="Is this location in use?"
        defaultValue={initial.active ? "active" : "retired"}
        error={e.status}
        options={[
          { value: "active", label: "In use", hint: "Its posters open the report form with this place filled in." },
          {
            value: "retired",
            label: "Retired",
            hint: "Its posters still open the report form, but without the place filled in. You can put it back in use later.",
          },
        ]}
      />
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={Save} />}>
          Save location
        </Button>
      </div>
    </form>
  );
}
