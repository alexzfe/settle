export interface Health {
  status: string;
}

export async function fetchHealth(): Promise<Health> {
  const response = await fetch("/health");
  if (!response.ok) throw new Error(`/health answered ${response.status}`);
  return (await response.json()) as Health;
}
