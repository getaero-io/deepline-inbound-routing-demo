import { expect, test } from "bun:test";
import { selectRepBooking, type FitAttributes } from "./rep-fit";

// Reserved domains ensure replay cannot book a real meeting.
const fallback = "https://booking.example/team";
const reps = [
  { id: "software", bookingUrl: "https://booking.example/software", attributes: {
    industry: ["B2B software"], specialty: ["CRM automation"],
    city: ["New York"], education: ["School A"], sports: ["Football"], interests: ["Chess"],
  } },
  { id: "healthcare", bookingUrl: "https://booking.example/healthcare", attributes: {
    industry: ["Healthcare"], specialty: ["Data integration"],
    city: ["Boston"], education: ["School B"], sports: ["Basketball"], interests: ["Photography"],
  } },
  { id: "finance", bookingUrl: null, attributes: {
    industry: ["Finance"], specialty: ["Compliance"],
  } },
];

const cases: Array<{
  name: string;
  attributes: FitAttributes;
  expected: string | null;
  score: number;
  signals: string[];
}> = [
  { name: "software lead with complete overlap", attributes: reps[0].attributes,
    expected: "software", score: 100,
    signals: ["industry", "specialty", "city", "education", "sports", "interests"] },
  { name: "industry beats school and sports overlap", attributes: {
    industry: ["Healthcare"], education: ["School A"], sports: ["Football"],
  }, expected: "healthcare", score: 45, signals: ["industry"] },
  { name: "professional fit tie breaks on shared background", attributes: {
    specialty: ["Data integration", "CRM automation"], city: ["Boston"], interests: ["Chess"],
  }, expected: "healthcare", score: 45, signals: ["specialty", "city"] },
  { name: "top fit lacks a booking calendar", attributes: { industry: ["Finance"] },
    expected: null, score: 0, signals: [] },
  { name: "unknown background", attributes: {}, expected: null, score: 0, signals: [] },
];

for (const { name, attributes, expected, score, signals } of cases) {
  test(`synthetic replay: ${name}`, () => {
    const result = selectRepBooking(attributes, reps, fallback);
    expect(result.repId).toBe(expected);
    expect(result.score).toBe(score);
    expect(result.reasons.map(({ signal }) => signal)).toEqual(signals);
    expect(result.bookingUrl).toBe(expected ? `https://booking.example/${expected}` : fallback);
  });
}

test("blank booking links cannot hide an available lower-fit rep", () => {
  for (const bookingUrl of ["", "   "]) {
    const result = selectRepBooking(
      { industry: ["B2B software"], specialty: ["Data integration"] },
      [{ ...reps[0], bookingUrl }, reps[1]],
      fallback,
    );
    expect(result.repId).toBe("healthcare");
    expect(result.bookingUrl).toBe("https://booking.example/healthcare");
    expect(result.score).toBe(35);
  }
});
