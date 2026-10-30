import { expect, test } from "bun:test";
import { workEmail } from "./capture";

test("partial capture accepts only normalized work-email identities", () => {
  expect(workEmail(" Avery@Business.com ")).toBe("avery@business.com");
  for (const domain of ["gmail.com", "outlook.com"])
    expect(workEmail(`fixture@${domain}`)).toBeNull();
  for (const value of [null, "bad", "a b@company.com"])
    expect(workEmail(value)).toBeNull();
});
