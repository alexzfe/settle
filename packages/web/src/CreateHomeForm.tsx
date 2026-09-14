import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import styles from "./App.module.css";
import { ApiError, call, type Operations } from "./api";
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
    <form className={styles.form} onSubmit={onSubmit}>
      <label>
        Name <input name="name" required />
      </label>
      <label>
        Country <input name="country" required />
      </label>
      <label>
        City <input name="city" required />
      </label>
      {askLatitude && (
        <label>
          Latitude <input name="latitude" type="number" step="any" min={-90} max={90} required />
        </label>
      )}
      <button type="submit" disabled={createHome.isPending}>
        Create Home
      </button>
      {createHome.isError && (
        <p role="alert" className={styles.error}>
          {createHome.error.message}
        </p>
      )}
    </form>
  );
}
