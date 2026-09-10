/**
 * Defensive date formatting utilities to ensure "Invalid Date" is never rendered.
 */

export function isDateValid(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

export function formatDateTime(dateStr?: string | null): string {
  if (!isDateValid(dateStr)) return "";
  const d = new Date(dateStr!);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatActivityDate(dateStr?: string | null): string {
  if (!isDateValid(dateStr)) return "";
  const d = new Date(dateStr!);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString();
  return `${time} · ${date}`;
}
