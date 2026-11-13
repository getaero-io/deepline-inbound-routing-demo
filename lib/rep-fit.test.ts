import { expect, test } from "bun:test";
import { rankRepFit } from "./rep-fit";

test("professional fit outranks shared interests and repeated evidence counts once", () => {
  const result = rankRepFit(
    { industry: ["Software"], specialty: ["CRM"], interests: ["Football"] },
    [
      { id: "a", attributes: { interests: ["Football"] } },
      { id: "b", attributes: { industry: [" software ", "Software"], specialty: ["CRM"] } },
    ],
  );
  expect(result.map(({ rep, score }) => [rep.id, score])).toEqual([["b", 80], ["a", 2]]);
  expect(result[0].reasons).toEqual([
    { signal: "industry", points: 45 },
    { signal: "specialty", points: 35 },
  ]);
});

test("ties are stable and missing evidence contributes zero", () => {
  expect(rankRepFit({}, [{ id: "b", attributes: {} }, { id: "a", attributes: {} }])
    .map(({ rep, score }) => [rep.id, score])).toEqual([["a", 0], ["b", 0]]);
});
