import { nairaToKobo } from "./utils/format";

export function onboardingServiceInput(form: { name: string; price: string; durationMinutes: string }) {
  const price = form.price.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw new Error("Enter a valid price in naira with at most two decimal places.");
  const kobo = nairaToKobo(Number(price));
  const durationMinutes = Number(form.durationMinutes);
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new Error("Enter a valid service price.");
  if (!form.name.trim() || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) throw new Error("Enter a service name and a valid whole-minute duration.");
  return { name: form.name.trim(), price: kobo, durationMinutes };
}

// Synchronous lock: two submit events in one React render cannot start twice.
export function createOnboardingSubmitLock() {
  let pending = false;
  return async (task: () => Promise<unknown>) => {
    if (pending) return;
    pending = true;
    try { await task(); } finally { pending = false; }
  };
}

export async function completeOnboardingAndRefresh(
  complete: () => Promise<unknown>,
  refreshAuth: () => Promise<void>,
) {
  await complete();
  // AuthContext's existing bootstrap gate handles temporary failures/retry.
  // OnboardingRoute navigates only when the refreshed OWNER is COMPLETED.
  await refreshAuth();
}
