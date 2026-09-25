import { isTransitionAllowed } from "../appointmentStateMachine";

describe("appointment state machine", () => {
  it("allows PENDING to move to CONFIRMED, CANCELLED, COMPLETED, or NO_SHOW", () => {
    expect(isTransitionAllowed("PENDING", "CONFIRMED")).toBe(true);
    expect(isTransitionAllowed("PENDING", "CANCELLED")).toBe(true);
    expect(isTransitionAllowed("PENDING", "COMPLETED")).toBe(true);
    expect(isTransitionAllowed("PENDING", "NO_SHOW")).toBe(true);
  });

  it("allows CONFIRMED to move back to PENDING (owner correction) as well as forward", () => {
    expect(isTransitionAllowed("CONFIRMED", "PENDING")).toBe(true);
    expect(isTransitionAllowed("CONFIRMED", "COMPLETED")).toBe(true);
    expect(isTransitionAllowed("CONFIRMED", "CANCELLED")).toBe(true);
    expect(isTransitionAllowed("CONFIRMED", "NO_SHOW")).toBe(true);
  });

  it("treats COMPLETED, CANCELLED, and NO_SHOW as terminal — nothing can transition out of them", () => {
    expect(isTransitionAllowed("COMPLETED", "PENDING")).toBe(false);
    expect(isTransitionAllowed("COMPLETED", "CONFIRMED")).toBe(false);
    expect(isTransitionAllowed("CANCELLED", "PENDING")).toBe(false);
    expect(isTransitionAllowed("CANCELLED", "CONFIRMED")).toBe(false);
    expect(isTransitionAllowed("NO_SHOW", "COMPLETED")).toBe(false);
  });

  it("rejects a 'transition' to the same status — that isn't a change", () => {
    expect(isTransitionAllowed("PENDING", "PENDING")).toBe(false);
    expect(isTransitionAllowed("COMPLETED", "COMPLETED")).toBe(false);
  });
});
