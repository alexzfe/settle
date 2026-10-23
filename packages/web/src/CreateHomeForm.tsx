import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import styles from "./App.module.css";
import { ApiError, call, type Operations } from "./api";
import layout from "./CreateHomeForm.module.css";
import { queryKeys } from "./queries";

/**
 * Creates a Home from its name, country, and city. The server derives the latitude from the city;
 * when it answers city_not_found, the form asks for the latitude and sends it with the next try.
 */
export function CreateHomeForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [askLatitude, setAskLatitude] = useState(false);
  const createHome = useMutation({
    mutationFn: (input: Operations["create_home"]["input"]) => call("create_home", input),
    onSuccess: ({ home }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.homes });
      void navigate(`/homes/${home.slug}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "city_not_found") setAskLatitude(true);
    },
  });

  // A changed place may be one the server knows, so the latitude it asked for goes away with the
  // refusal; the required field would otherwise keep the corrected city from ever being looked up.
  function placeChanged() {
    if (!askLatitude) return;
    setAskLatitude(false);
    createHome.reset();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (field: string) => String(form.get(field) ?? "").trim();
    const latitude = form.get("latitude");
    createHome.mutate({
      name: text("name"),
      country: text("country"),
      city: text("city"),
      ...(latitude === null ? {} : { latitude: Number(latitude) }),
    });
  }

  return (
    <form className={`${styles.form} ${layout.form}`} onSubmit={onSubmit}>
      <label className={layout.wide}>
        Name <input name="name" required placeholder="Our flat" />
      </label>
      <label>
        Country <input name="country" required onChange={placeChanged} />
      </label>
      <label>
        City <input name="city" required onChange={placeChanged} />
      </label>
      {askLatitude && (
        <label className={layout.wide}>
          Latitude <input name="latitude" type="number" step="any" min={-90} max={90} required />
        </label>
      )}
      <button type="submit" className={layout.wide} disabled={createHome.isPending}>
        Create Home
      </button>
      {createHome.isError && (
        <p role="alert" className={`${styles.error} ${layout.wide}`}>
          {createHome.error.message}
        </p>
      )}
    </form>
  );
}
