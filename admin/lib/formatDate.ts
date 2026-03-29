function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Display instant as calendar date dd/mm/yyyy in local time. */
export function formatDateDdMmYyyy(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Date as dd/mm/yyyy and capture time (local) as hh:mm:ss (12-hour clock with AM/PM). */
export function formatDateTimeDdMmYyyy(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const datePart = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const timePart = `${h}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
  return `${datePart}, ${timePart}`;
}
